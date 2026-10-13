#!/usr/bin/env bash
# Shared by commit-gate.sh and commit-check.sh. The caller sets ROOT to the project's working
# copy, then sources this file. It defines functions only: each returns non-zero on failure
# and none exits, so the caller decides in its own main shell.
#
#
#   cg_touched_packages   the packages with an uncommitted change under their folder, one per line
#   cg_fingerprint <pkg>  one hash over the content of every tracked or untracked-and-not-ignored
#                         regular file under the package; the paths are sorted, because
#                         `git ls-files` lists untracked files first and staging would move it
#   cg_stamp_rows         `package<TAB>true|false<TAB>fingerprint` per stamp entry; non-zero unless
#                         the stamp is the record commit-check.sh writes. `green` is read by type:
#                         jq's `//` would turn a `false` into the default
#
# Needs bash, git, awk, and jq or node. Git is called read-only, always as `git -C "$ROOT"`.

CG_PACKAGES=(server client reviewer-core mcp)
CG_STAMP="$ROOT/.claude/commit-gate/last-green.json"

cg_touched_packages() {
  local out line path part pkg found=""
  out="$(GIT_OPTIONAL_LOCKS=0 git -C "$ROOT" status --porcelain --untracked-files=normal 2>/dev/null)" || return 1
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    path="${line:3}"
    for part in "${path%% -> *}" "${path##* -> }"; do
      part="${part#\"}"
      part="${part%%/*}"
      for pkg in "${CG_PACKAGES[@]}"; do
        [[ "$part" == "$pkg" ]] && found+=" $pkg "
      done
    done
  done <<<"$out"
  for pkg in "${CG_PACKAGES[@]}"; do
    [[ "$found" == *" $pkg "* ]] && printf '%s\n' "$pkg"
  done
  return 0
}

cg_fingerprint() {
  local pkg="$1" paths ids p id
  paths="$(
    set -o pipefail
    git -C "$ROOT" ls-files -z --cached --others --exclude-standard --deduplicate -- "$pkg" 2>/dev/null \
      | while IFS= read -r -d '' p; do
          [[ "$p" == *$'\n'* ]] && exit 1
          if [[ -f "$ROOT/$p" ]]; then printf '%s\n' "$p"; fi
        done \
      | LC_ALL=C awk '
          function qsort(A, lo, hi,   i, last, t) {
            if (lo >= hi) return
            i = lo + int((hi - lo) / 2); t = A[lo]; A[lo] = A[i]; A[i] = t
            last = lo
            for (i = lo + 1; i <= hi; i++)
              if ((A[i] "") < (A[lo] "")) { last++; t = A[last]; A[last] = A[i]; A[i] = t }
            t = A[lo]; A[lo] = A[last]; A[last] = t
            qsort(A, lo, last - 1); qsort(A, last + 1, hi)
          }
          { A[NR] = $0 }
          END { qsort(A, 1, NR); for (i = 1; i <= NR; i++) print A[i] }'
  )" || return 1
  if [[ -z "$paths" ]]; then
    git -C "$ROOT" hash-object --stdin </dev/null
    return
  fi
  ids="$(git -C "$ROOT" hash-object --no-filters --stdin-paths <<<"$paths" 2>/dev/null)" || return 1
  while IFS= read -r p <&3 && IFS= read -r id <&4; do
    printf '%s\t%s\n' "$p" "$id"
  done 3<<<"$paths" 4<<<"$ids" | git -C "$ROOT" hash-object --stdin
}

cg_stamp_rows() {
  if command -v jq >/dev/null 2>&1; then
    jq -rs '
      if length == 1 and (.[0] | type) == "object" then .[0] else error("not one object") end
      | if (.written_at | type) == "string" and (.packages | type) == "object" then .packages
        else error("fields missing") end
      | to_entries[]
      | if (.value | type) == "object" and (.value.green | type) == "boolean"
           and (.value.fingerprint | type) == "string"
           and ((.key + .value.fingerprint) | test("[\t\n\r]") | not)
        then [.key, (if .value.green == true then "true" else "false" end), .value.fingerprint] | join("\t")
        else error("bad entry") end' "$CG_STAMP" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e '
      const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
      let stamp;
      try { stamp = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
      if (!isObject(stamp) || typeof stamp.written_at !== "string" || !isObject(stamp.packages)) process.exit(1);
      const rows = [];
      for (const [name, entry] of Object.entries(stamp.packages)) {
        if (!isObject(entry) || typeof entry.green !== "boolean" || typeof entry.fingerprint !== "string") process.exit(1);
        if (/[\t\n\r]/.test(name + entry.fingerprint)) process.exit(1);
        rows.push(name + "\t" + (entry.green === true ? "true" : "false") + "\t" + entry.fingerprint + "\n");
      }
      process.stdout.write(rows.join(""));' "$CG_STAMP" 2>/dev/null
  else
    return 1
  fi
}
