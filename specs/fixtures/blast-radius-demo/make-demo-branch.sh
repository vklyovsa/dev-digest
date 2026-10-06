#!/usr/bin/env bash
# Builds the Blast Radius demo PR branch in a FRESH clone of the fork (never in this working tree).
# Does not commit and does not push. Usage: specs/fixtures/blast-radius-demo/make-demo-branch.sh [clone-dir]
set -euo pipefail

CLONE_DIR="${1:-/tmp/dd-blast-radius-demo}"
REPO_URL="${REPO_URL:-https://github.com/vklyovsa/dev-digest.git}"
BRANCH="${BRANCH:-demo/blast-radius}"
TARGET="server/src/platform/errors.ts"

if [ -e "$CLONE_DIR" ]; then
  echo "Refusing to reuse $CLONE_DIR — remove it or pass another path." >&2
  exit 1
fi

git clone "$REPO_URL" "$CLONE_DIR"
cd "$CLONE_DIR"
git checkout -b "$BRANCH" origin/main

# One shared helper, changed in place: `AppError` is the base of every API error, so the
# map shows callers of all five classes — some behind HTTP routes, some not, one unused.
python3 - "$TARGET" <<'PY'
import sys

path = sys.argv[1]
source = open(path, encoding="utf-8").read()
anchor = "    this.name = 'AppError';\n"
if source.count(anchor) != 1:
    sys.exit(f"{path}: anchor not found exactly once — the file changed upstream, adjust this script")
patched = source.replace(
    anchor,
    "    this.name = new.target.name;\n"
    "    Object.setPrototypeOf(this, new.target.prototype);\n",
)
open(path, "w", encoding="utf-8").write(patched)
PY

git add "$TARGET"
git status --short
git diff --cached --stat

cat <<EOF

Branch $BRANCH is ready in $CLONE_DIR (NOT committed, NOT pushed). Next:
  cd $CLONE_DIR
  git commit -m "fix(server): keep the subclass name and prototype on AppError"
  git push -u origin $BRANCH
Then open a PR from $BRANCH into main on GitHub, refresh the PR list in DevDigest and open
the PR: Overview → Blast radius.
EOF
