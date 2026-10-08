#!/usr/bin/env python3
"""Collect one eval run into its run directory.

    collect_run.py <working-copy> <pristine-base> <run-dir>

Writes into <run-dir>/outputs/:
  ANSWER.md      the executor's final answer
  changes.patch  unified diff of the copy against the pristine base
  checks.json    mechanical facts a grader can cite: typecheck, dependency-cruiser,
                 route greps, test runs, and what the ADDED lines contain

Only facts are recorded here. Which expectation a fact satisfies is the grader's call.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

SKIP = ["node_modules", "ANSWER.md", "check.sh", "*.patch"]


def sh(cmd: str, cwd: Path, timeout: int = 600) -> tuple[int, str]:
    p = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).strip()


def unified_diff(base: Path, copy: Path) -> str:
    excludes = " ".join(f"-x '{s}'" for s in SKIP)
    _, out = sh(f"diff -ruN {excludes} '{base.name}' '{copy.name}'", cwd=base.parent)
    lines = []
    for line in out.splitlines():
        if line.startswith("diff -ruN "):
            continue
        m = re.match(rf"^--- {re.escape(base.name)}/([^\t]+)", line)
        if m:
            lines.append(f"--- a/{m.group(1)}")
            continue
        m = re.match(rf"^\+\+\+ {re.escape(copy.name)}/([^\t]+)", line)
        if m:
            lines.append(f"+++ b/{m.group(1)}")
            continue
        lines.append(line)
    return "\n".join(lines) + "\n"


def added_lines(patch: str) -> dict[str, list[tuple[int, str]]]:
    """file -> [(new line number, text)] for every added line."""
    out: dict[str, list[tuple[int, str]]] = {}
    current, lineno = None, 0
    for line in patch.splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
            out.setdefault(current, [])
        elif line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            lineno = int(m.group(1)) if m else 0
        elif current and line.startswith("+") and not line.startswith("+++"):
            out[current].append((lineno, line[1:]))
            lineno += 1
        elif current and not line.startswith("-"):
            lineno += 1
    return out


def grep_added(added, path_re: str, text_re: str) -> list[str]:
    hits = []
    for path, lines in added.items():
        if not re.search(path_re, path):
            continue
        for n, text in lines:
            if re.search(text_re, text):
                hits.append(f"{path}:{n}: {text.strip()}")
    return hits


def main() -> None:
    copy, base, run_dir = (Path(a).resolve() for a in sys.argv[1:4])
    outputs = run_dir / "outputs"
    outputs.mkdir(parents=True, exist_ok=True)

    answer = copy / "ANSWER.md"
    (outputs / "ANSWER.md").write_text(answer.read_text() if answer.exists() else "(no ANSWER.md written)\n")

    patch = unified_diff(base, copy)
    (outputs / "changes.patch").write_text(patch)
    added = added_lines(patch)
    server = copy / "server"

    tsc_rc, tsc_out = sh("./node_modules/.bin/tsc --noEmit -p tsconfig.json", server)
    dep_rc, dep_out = sh("./node_modules/.bin/depcruise src --config .dependency-cruiser.cjs", server)
    _, route_adapter = sh(
        r"""grep -nE "container\.(github\(|llm\(|git\b|codeIndex|embedder\(|secrets)" src/modules/*/routes.ts""",
        server,
    )
    _, route_store = sh(r"""grep -nE "container\.(db\b|\w+Repo\b)" src/modules/*/routes.ts""", server)

    tests = sorted(p for p in added if re.search(r"^server/test/.*\.test\.ts$", p) and added[p])
    test_runs = []
    for t in tests:
        rel = t[len("server/"):]
        body = (copy / t).read_text() if (copy / t).exists() else ""
        hermetic = not rel.endswith(".it.test.ts") and "helpers/pg" not in body
        rc, out = (None, "skipped: DB-backed") if not hermetic else sh(
            f"./node_modules/.bin/vitest run {rel}", server, timeout=900
        )
        test_runs.append({
            "file": t,
            "hermetic": hermetic,
            "exit_code": rc,
            "tail": "\n".join(out.splitlines()[-12:]),
        })

    checks = {
        "files_changed": {p: len(v) for p, v in sorted(added.items()) if v},
        "typecheck": {"exit_code": tsc_rc, "output": tsc_out[-2000:]},
        "depcruise": {"exit_code": dep_rc, "output": dep_out[-2000:]},
        "routes_calling_adapter_on_container": route_adapter.splitlines(),
        "routes_touching_db_or_repo_on_container": route_store.splitlines(),
        "test_runs": test_runs,
        "added": {
            "drizzle_or_schema_import_in_routes": grep_added(
                added, r"modules/[^/]+/routes\.ts$", r"drizzle-orm|db/schema|db/rows"),
            "new_service_or_repository_outside_container": grep_added(
                added, r"^server/src/(?!platform/container\.ts)", r"\bnew \w+(Service|Repository)\("),
            "new_adapter_class_outside_container": grep_added(
                added, r"^server/src/(?!platform/container\.ts|adapters/mocks\.ts)", r"\bnew \w+(Notifier|Client|Provider|Sender|Webhook\w*)\("),
            "http_call_in_modules": grep_added(
                added, r"^server/src/modules/", r"\bfetch\(|undici|axios|node:https?"),
            "http_call_in_adapters": grep_added(
                added, r"^server/src/adapters/", r"\bfetch\(|undici|axios|node:https?"),
            "process_env": grep_added(added, r"^(server|reviewer-core)/src/", r"process\.env"),
            "row_types_in_service_files": grep_added(
                added, r"modules/[^/]+/(service|types|deps)\.ts$", r"\b\w+Row\b|\$inferSelect"),
            "container_type_in_modules": grep_added(
                added, r"^server/src/modules/", r"platform/container|\bContainer\b"),
            "drizzle_prefixed_or_repository_port_names": grep_added(
                added, r"^server/src/", r"\bDrizzle\w+|\w+RepositoryPort\b|\buow\b"),
            "interfaces_declared": grep_added(added, r"^server/src/", r"^export (interface|type) \w+"),
            "container_overrides_fields": grep_added(
                added, r"platform/container\.ts$", r"^\s+\w+\?: \w+"),
            "mocks_ts": grep_added(added, r"adapters/mocks\.ts$", r"^export (class|interface|function|const) \w+"),
        },
        "new_files": sorted(
            p for p in added
            if not (base / p).exists() and (copy / p).exists()
        ),
        "contract_copies": {
            "server": sorted(p for p in added if p.startswith("server/src/vendor/shared/") and added[p]),
            "client": sorted(p for p in added if p.startswith("client/src/vendor/shared/") and added[p]),
        },
    }
    (outputs / "checks.json").write_text(json.dumps(checks, indent=2, ensure_ascii=False) + "\n")
    print(f"{run_dir.name}: {len(checks['files_changed'])} files changed, "
          f"tsc={tsc_rc} depcruise={dep_rc} tests={[(t['file'], t['exit_code']) for t in test_runs]}")


if __name__ == "__main__":
    main()
