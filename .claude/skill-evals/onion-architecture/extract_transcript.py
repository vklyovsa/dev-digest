#!/usr/bin/env python3
"""Turn one subagent JSONL transcript into a readable trajectory plus metrics.

    extract_transcript.py <agent.jsonl> <run-dir> [--real-repo <path>] [--skill-dir <path>]

Writes <run-dir>/outputs/transcript.md and <run-dir>/outputs/metrics.json.

Token usage is summed per API response (one response is several JSONL lines sharing
`message.id`, with `usage` growing while it streams, so the maximum per id is taken).
That sum is what the run cost; the figure a task notification reports is only the
context size of the last call.
"""
import argparse
import json
from collections import Counter
from datetime import datetime
from pathlib import Path


def clip(text: str, n: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[:n] + " …"


def tool_summary(name: str, inp: dict) -> str:
    for key in ("file_path", "path", "command", "pattern", "skill", "query", "prompt", "description"):
        if key in inp:
            extra = f" [{inp['pattern']}]" if key == "path" and "pattern" in inp else ""
            return f"{name}: {clip(inp[key], 400)}{extra}"
    return f"{name}: {clip(json.dumps(inp, ensure_ascii=False), 300)}"


def result_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl", type=Path)
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--real-repo", default="/home/klov/emdash/repositories/dev-digest")
    ap.add_argument("--skill-dir", default="/tmp/dd-kit-7f3a")
    args = ap.parse_args()

    steps: list[str] = []
    tools: Counter = Counter()
    usage: dict[str, dict] = {}
    errors = 0
    skill_reads: list[str] = []
    real_repo_touches: list[str] = []
    skill_tool_calls: list[str] = []
    timestamps: list[str] = []
    models: Counter = Counter()

    for raw in args.jsonl.read_text().splitlines():
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if row.get("timestamp"):
            timestamps.append(row["timestamp"])
        msg = row.get("message")
        if not isinstance(msg, dict):
            continue
        if msg.get("usage") and msg.get("id"):
            u = msg["usage"]
            prev = usage.get(msg["id"], {})
            usage[msg["id"]] = {
                k: max(prev.get(k, 0), u.get(k) or 0)
                for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")
            }
            if msg.get("model"):
                models[msg["model"]] += 0 if msg["id"] in prev else 1
        content = msg.get("content")
        if isinstance(content, str):
            if msg.get("role") == "user":
                steps.append(f"**USER**\n\n{clip(content, 1500)}")
            continue
        for item in content or []:
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            if kind == "text" and item.get("text", "").strip():
                steps.append(f"**ASSISTANT** {clip(item['text'], 1200)}")
            elif kind == "tool_use":
                name, inp = item.get("name", "?"), item.get("input") or {}
                tools[name] += 1
                blob = json.dumps(inp, ensure_ascii=False)
                if name == "Skill":
                    skill_tool_calls.append(clip(blob, 200))
                if args.skill_dir in blob and name in ("Read", "Grep", "Glob", "Bash"):
                    skill_reads.append(clip(inp.get("file_path") or inp.get("path") or inp.get("command") or blob, 200))
                if args.real_repo in blob:
                    real_repo_touches.append(f"{name}: {clip(blob, 240)}")
                steps.append(f"- `{tool_summary(name, inp)}`")
            elif kind == "tool_result":
                if item.get("is_error"):
                    errors += 1
                    steps.append(f"  - ERROR: {clip(result_text(item.get('content')), 300)}")

    totals = {k: sum(u[k] for u in usage.values())
              for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")}
    totals["all"] = sum(totals.values())

    duration = None
    if len(timestamps) >= 2:
        t0, t1 = (datetime.fromisoformat(t.replace("Z", "+00:00")) for t in (min(timestamps), max(timestamps)))
        duration = round((t1 - t0).total_seconds(), 1)

    outputs = args.run_dir / "outputs"
    outputs.mkdir(parents=True, exist_ok=True)
    transcript = "# Trajectory\n\n" + "\n\n".join(steps) + "\n"
    (outputs / "transcript.md").write_text(transcript)

    output_chars = sum(p.stat().st_size for p in outputs.iterdir()
                       if p.is_file() and p.name not in ("transcript.md", "metrics.json"))
    metrics = {
        "tool_calls": dict(tools.most_common()),
        "total_tool_calls": sum(tools.values()),
        "total_steps": len(usage),
        "errors_encountered": errors,
        "output_chars": output_chars,
        "transcript_chars": len(transcript),
        "model": models.most_common(1)[0][0] if models else None,
        "duration_seconds": duration,
        "usage": totals,
        "skill_files_read": sorted(set(skill_reads)),
        "skill_tool_calls": skill_tool_calls,
        "real_repo_touches": real_repo_touches,
    }
    (outputs / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n")
    print(f"{args.run_dir}: {metrics['total_steps']} API calls, {metrics['total_tool_calls']} tool calls, "
          f"{totals['all']:,} tokens ({totals['cache_read_input_tokens']:,} cache read), "
          f"{duration}s, skill files read: {len(metrics['skill_files_read'])}, "
          f"real-repo touches: {len(real_repo_touches)}, Skill tool calls: {len(skill_tool_calls)}")


if __name__ == "__main__":
    main()
