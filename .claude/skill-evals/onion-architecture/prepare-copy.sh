#!/usr/bin/env bash
# Build a throwaway working copy of the backend for one eval run, so parallel
# runs never share a tree and nothing touches the real repository.
#
#   prepare-copy.sh <dest-dir> [patch-file]
#
# The copy holds server/, reviewer-core/, client/src/vendor/shared, the root
# AGENTS.md / TESTING.md and a check.sh (tsc + dependency-cruiser). No .claude/,
# no .env. node_modules are symlinks into the real packages: read them, never
# install into them.
set -euo pipefail

dest="${1:?usage: prepare-copy.sh <dest-dir> [patch-file]}"
patch_file="${2:-}"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"

[ -e "$dest" ] && { echo "refusing to overwrite $dest" >&2; exit 2; }
mkdir -p "$dest/client/src/vendor"

tar -C "$repo" -cf - \
  --exclude=node_modules --exclude=clones --exclude=dist --exclude=coverage \
  --exclude='*.tsbuildinfo' --exclude='.env' --exclude='.env.local' \
  server reviewer-core | tar -C "$dest" -xf -
cp -r "$repo/client/src/vendor/shared" "$dest/client/src/vendor/shared"
cp "$repo/AGENTS.md" "$repo/TESTING.md" "$dest/"
ln -s "$repo/server/node_modules" "$dest/server/node_modules"
ln -s "$repo/reviewer-core/node_modules" "$dest/reviewer-core/node_modules"

cat > "$dest/check.sh" <<'EOF'
#!/usr/bin/env bash
# Typecheck + layering check for this working copy. node_modules is a shared
# symlink: never run pnpm / npm here.
set -u
cd "$(dirname "$0")/server" || exit 2
rc=0
echo "== tsc --noEmit"; ./node_modules/.bin/tsc --noEmit -p tsconfig.json || rc=1
echo "== depcruise";    ./node_modules/.bin/depcruise src --config .dependency-cruiser.cjs || rc=1
exit $rc
EOF
chmod +x "$dest/check.sh"

if [ -n "$patch_file" ]; then
  patch -d "$dest" -p1 -s < "$patch_file"
  cp "$patch_file" "$dest/$(basename "$patch_file")"
fi

echo "$dest"
