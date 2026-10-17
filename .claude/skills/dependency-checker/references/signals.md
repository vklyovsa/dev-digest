# Signals — how to check each one and where it usually lands

The collector prints a `SIGNALS` table. Each row is a rule that fired on the numbers, not a
conclusion. For every rule: what it means, how to check it, when to drop it, the usual tier
and the usual recommendation. The tier definitions are in `SKILL.md` § Priority tiers; this
file only applies them.

## Internal

| Rule | Means | Check | Drop when | Usual tier | Usual recommendation |
|---|---|---|---|---|---|
| `CROSS-PACKAGE-RELATIVE` | A file imports another package through a relative path (`../../other/src/x`) instead of that package's alias or entry point | Open the example file, read the import | The path only looks like another package (a fixture, a string) | **P0**; P1 when only a test file does it | Import through the alias or the public entry point; export the symbol there if it is missing |
| `VENDORED-DRIFT` | Two vendored copies of the same alias differ | Diff the listed files; find out whether both sides use the differing part | The repository documents the difference as intentional → Info | **P0** when a contract both sides use differs; P1 when one side simply lacks a file it does not use | Land the change in both copies, naming both paths |
| `VERSION-DRIFT` | One external library, different versions in different packages | Read the drift kind and whether the library's types cross a package boundary | `range only` on dev tooling | **P0** major drift across a shared contract · **P1** minor/patch drift of a boundary-crossing library · P2 dev tooling · Info range-only | Align every listed `package.json` on one version, highest installed first |

## External — correctness

| Rule | Means | Check | Drop when | Usual tier | Usual recommendation |
|---|---|---|---|---|---|
| `PHANTOM` | Source imports a package its own `package.json` does not declare | Open the example file: is it a real import statement? | The match is inside a string, a template literal, a fixture or a comment | **P0** in shipped source · P1 in tests only | Add it to that package's `package.json` with its package manager |
| `MISSING` | Declared, but not in `node_modules` | Check the lockfile for the entry | The package was never installed at all (`NOT-INSTALLED`) | **P0** | Run the package's install; if the lockfile lacks it, re-add it through the package manager |
| `NOT-INSTALLED` | The package has no `node_modules` | — | — | Info, in Scope | Name the install command; sizes for this package are `—` |
| `NO-LOCKFILE` | No lockfile beside `package.json` | — | — | **P1** | Generate and commit the lockfile with the package's manager |
| `LOOSE-RANGE` | Declared as `*`, `latest`, a git URL or a file path | Read the line | A deliberate local link the repository documents | P1 | Pin a semver range |

## External — security and freshness (online mode)

| Rule | Means | Check | Drop when | Usual tier | Usual recommendation |
|---|---|---|---|---|---|
| `VULN` | A critical or high advisory on an installed version | Read the tree (`runtime` / `dev-only`) and the `via` chain; for a runtime hit, check the affected feature is reachable | Never dropped — an unreachable one is kept at a lower tier with the reason | **P0** runtime, critical or high · **P1** dev-only critical, or runtime but shown unreachable | Upgrade the direct dependency named in `via` to the first version outside the affected range |
| `VULN-DEV` | High advisories in the dev-only tree, folded into one row | Group by the direct dependency that brings them | — | P2 | One upgrade of the tool that brings most of them |
| `VULN-MINOR` | Moderate and low advisories, folded | — | — | P2, one finding per package at most | Covered by the upgrades above; list what remains |
| `OUTDATED-MAJOR` | A runtime dependency one or more majors behind | Is the installed line still maintained? Does a `VULN` or `DEPRECATED` point at it? | — | **P1** when an advisory or deprecation is fixed only upstream · P2 otherwise | Plan the major upgrade; link the migration guide when the deprecation message gives one |
| `OUTDATED-MAJOR-DEV` | Dev tooling a major behind, folded | — | — | P2, one finding per package | Upgrade together with the matching tool in the other packages |
| `DEPRECATED` | A direct dependency its maintainers deprecated | Read the message | — | **P1** runtime · P2 dev | Move to the replacement the message names |
| `DEPRECATED-TRANSITIVE` | A deprecated package further down the tree | Read `via` | The message is only a rename with no risk and the parent has no newer release → Info | P2 | Upgrade the direct dependency in `via`; do not add an override unless an advisory demands it |

## External — cost

| Rule | Means | Check | Drop when | Usual tier | Usual recommendation |
|---|---|---|---|---|---|
| `UNUSED` | No import, CLI use, config mention or string reference found | Grep the name across the package, its config files, scripts and CI; check whether another dependency loads it as a plugin or peer | It is loaded by name, by a framework convention or as a peer | **P1** runtime · P2 dev | Remove it with the package manager — as a proposal, after the user confirms |
| `PROD-NOT-RUNTIME` | In `dependencies`, used only by tests, config or a CLI | Confirm no shipped file imports it | It is imported at runtime through a string or a dynamic import | P1 | Move it to `devDependencies` |
| `DEV-IN-SRC` | In `devDependencies`, imported by non-test source | Is that source shipped, or is it tooling that only runs in development? | The importing file is itself tooling (a script, an eval harness, a config) | P1 when shipped · Info when tooling | Move it to `dependencies` |
| `HEAVY-LOW-USE` | 10 MB or more that only this dependency brings, imported from at most two files | Open the importing files: how much of the library is used? For a browser package, is it loaded lazily? | Never dropped; it is a fact | P2 | Name the lighter alternative or the lazy import; state the megabytes it frees |
| `DUPLICATES` | The same package installed in several versions | Read which direct dependencies pull the old versions | — | P2 · Info under 5 MB | Upgrade the dependency that pins the old version; do not add overrides for size alone |

## Infra

| Rule | Means | Usual tier | Usual recommendation |
|---|---|---|---|
| `ACTION-TAG` | A GitHub Action referenced by tag, not by commit | Info, one finding for all of them | Pin third-party actions to a commit SHA; first-party `actions/*` on a major tag is a common, accepted choice |
| `IMAGE-TAG` | A Docker image referenced by tag, not by digest | Info | Pin the digest where reproducible builds matter; say which file |

## Reading the size columns

- **Own** — the dependency's folder alone.
- **With transitives** — plus everything it pulls in. A peer the package declares itself
  (`react` for `react-dom`, `next` for `next-intl`) is counted to its own row, not here.
- **Only this brings** — what leaves `node_modules` if this one dependency is removed. This
  is the number to quote in a recommendation; `0 B` means everything it needs is also
  needed by something else.
- **Used by** — files importing it, split into `src`, `test`, `config`, `css`; or how else
  it is reached (`cli`, `config`, `string ref`, `types`, `peer of …`).

Installed size is disk size. For a package that ships to the browser it says what an
install costs, not what a visitor downloads — never present it as bundle size.
