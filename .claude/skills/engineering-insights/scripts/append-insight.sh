#!/usr/bin/env bash
# Appends one entry to a section of an INSIGHTS.md file, newest first.
# Append-only by construction: the result is verified to contain every input line.
set -euo pipefail

usage() {
  cat <<'USAGE'
append-insight.sh — append one entry to an INSIGHTS.md section, newest first.

  append-insight.sh --module <name> --section "<heading>" [--dry-run]
  append-insight.sh --file <path>   --section "<heading>" [--dry-run]

The entry body is read from stdin.

Modules:  root · server · client · reviewer-core · e2e
Sections: "What Works" · "What Doesn't Work" · "Codebase Patterns"
          "Tool & Library Notes" · "Recurring Errors & Fixes"
          "Session Notes" · "Open Questions"

Example:
  printf '%s\n' \
    '- **Migrations never run on boot.** A fresh DB fails at route level with' \
    '  `relation ... does not exist`, not at startup.' \
    '  → Run `pnpm db:migrate` before reading the code.' \
  | append-insight.sh --module server --section "Recurring Errors & Fixes"
USAGE
}

MODULE="" FILE="" SECTION="" DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --module)  MODULE="${2:-}"; shift 2 ;;
    --file)    FILE="${2:-}"; shift 2 ;;
    --section) SECTION="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "append-insight: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "append-insight: $*" >&2; exit 1; }

if [ -z "$SECTION" ]; then die "--section is required"; fi
if [ -n "$MODULE" ] && [ -n "$FILE" ]; then die "pass either --module or --file, not both"; fi

if [ -z "$FILE" ]; then
  [ -n "$MODULE" ] || die "one of --module or --file is required"
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$ROOT" ] || die "not inside a git repository; use --file with an explicit path"
  case "$MODULE" in
    root)          FILE="$ROOT/INSIGHTS.md" ;;
    server)        FILE="$ROOT/server/INSIGHTS.md" ;;
    client)        FILE="$ROOT/client/INSIGHTS.md" ;;
    reviewer-core) FILE="$ROOT/reviewer-core/INSIGHTS.md" ;;
    e2e)           FILE="$ROOT/e2e/INSIGHTS.md" ;;
    *) die "unknown module '$MODULE'. Use: root, server, client, reviewer-core, e2e" ;;
  esac
fi

[ -f "$FILE" ] || die "no such file: $FILE"

if ! grep -qxF -- "## $SECTION" "$FILE"; then
  echo "append-insight: '$FILE' has no section '## $SECTION'. Available:" >&2
  grep '^## ' "$FILE" >&2
  exit 1
fi

TMPDIR_RUN="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_RUN"' EXIT
ENTRY="$TMPDIR_RUN/entry"

# Strip trailing blank lines so the inserted block never carries dangling whitespace.
cat > "$TMPDIR_RUN/raw"
awk 'BEGIN{n=0} {l[++n]=$0} END{last=0; for(i=1;i<=n;i++) if(l[i] ~ /[^[:space:]]/) last=i; for(i=1;i<=last;i++) print l[i]}' \
  "$TMPDIR_RUN/raw" > "$ENTRY"

[ -s "$ENTRY" ] || die "the entry body was empty (it is read from stdin)"

LINES="$(wc -l < "$ENTRY" | tr -d ' ')"
if [ "$LINES" -gt 12 ]; then
  die "entry is $LINES lines. An insight is 1-3 lines (a Session Note, 2-4). Trim it, or it is a task log, not an insight."
fi

FIRST="$(head -n 1 "$ENTRY")"
if [ "$SECTION" = "Session Notes" ]; then
  case "$FIRST" in
    '### '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*) ;;
    *) die "a Session Note must start with '### YYYY-MM-DD — topic' (use today's real date from \`date +%F\`); got: $FIRST" ;;
  esac
else
  case "$FIRST" in
    '- '*) ;;
    *) die "an entry in '$SECTION' must start with '- **Claim.**'; got: $FIRST" ;;
  esac
fi

# An entry already present verbatim is never appended a second time.
FIRST_TRIMMED="$(printf '%s' "$FIRST" | sed 's/[[:space:]]*$//')"
if grep -qxF -- "$FIRST_TRIMMED" "$FILE"; then
  die "that first line is already in $FILE verbatim. Read the section before appending; if it needs correcting, append a dated correction instead."
fi

OUT="$TMPDIR_RUN/out"
awk -v section="$SECTION" -v entryfile="$ENTRY" '
  function trim(s) { sub(/[[:space:]]+$/, "", s); return s }
  function emit(  i) { for (i = 1; i <= n; i++) print lines[i] }
  BEGIN {
    n = 0
    while ((getline l < entryfile) > 0) lines[++n] = l
    close(entryfile)
    target = "## " section
    inside = 0; done = 0
  }
  {
    line = trim($0)
    if (line ~ /^## /) {
      if (inside && !done) { emit(); print ""; done = 1 }
      inside = (line == target)
      print; next
    }
    if (inside && !done) {
      if (line == "_None yet._") { emit(); done = 1; next }
      if (line ~ /^- / || line ~ /^### /) { emit(); print ""; print; done = 1; next }
    }
    print
  }
  END { if (inside && !done) { print ""; emit() } }
' "$FILE" > "$OUT"

# Append-only guard: the placeholder is the only line this script may ever remove.
diff "$FILE" "$OUT" > "$TMPDIR_RUN/diff" || true
grep '^< ' "$TMPDIR_RUN/diff" > "$TMPDIR_RUN/removed" || true
if grep -qv '^< _None yet\._$' "$TMPDIR_RUN/removed"; then
  echo "append-insight: refusing to write, the rewrite would drop existing lines:" >&2
  grep -v '^< _None yet\._$' "$TMPDIR_RUN/removed" >&2
  exit 1
fi
if [ "$(wc -c < "$OUT")" -le "$(wc -c < "$FILE")" ]; then
  die "refusing to write: $FILE would not grow"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  diff -u "$FILE" "$OUT" || true
  echo "append-insight: dry run, $FILE untouched" >&2
  exit 0
fi

DEST_TMP="$(dirname "$FILE")/.$(basename "$FILE").tmp.$$"
cp "$OUT" "$DEST_TMP"
chmod --reference="$FILE" "$DEST_TMP" 2>/dev/null || true
mv -f "$DEST_TMP" "$FILE"
echo "append-insight: added ${LINES}-line entry to '## $SECTION' in $FILE" >&2
