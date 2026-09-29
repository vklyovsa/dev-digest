#!/usr/bin/env bash
# Builds the Smart Diff demo PR branch in a FRESH clone of the fork (never in this working tree).
# Does not push. Usage: specs/fixtures/smart-diff-demo/make-demo-branch.sh [clone-dir]
set -euo pipefail

FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLONE_DIR="${1:-/tmp/dd-smart-diff-demo}"
REPO_URL="${REPO_URL:-https://github.com/vklyovsa/dev-digest.git}"
BRANCH="${BRANCH:-demo/smart-diff}"

if [ -e "$CLONE_DIR" ]; then
  echo "Refusing to reuse $CLONE_DIR — remove it or pass another path." >&2
  exit 1
fi

git clone "$REPO_URL" "$CLONE_DIR"
cd "$CLONE_DIR"
git checkout -b "$BRANCH" origin/main

cp -R "$FIXTURE_DIR/files/." .

# pnpm >= 11 exits non-zero on "ignored build scripts" (esbuild, sharp) AFTER writing the
# manifest and the lockfile, so success is checked on the lockfile instead of the exit code.
(cd client && pnpm add pretty-ms@^9) || true
grep -q "pretty-ms" client/pnpm-lock.yaml || { echo "pnpm did not add pretty-ms" >&2; exit 1; }
git checkout -- client/pnpm-workspace.yaml 2>/dev/null || true

git add client/package.json client/pnpm-lock.yaml client/src/lib/format client/docs/format-duration.md
git status --short

cat <<EOF

Branch $BRANCH is ready in $CLONE_DIR (NOT committed, NOT pushed). Next:
  cd $CLONE_DIR
  git commit -m "feat(client): duration formatting helpers"
  git push -u origin $BRANCH
Then open a PR from $BRANCH into main on GitHub and refresh the PR list in DevDigest.
EOF
