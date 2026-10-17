# SDD profile — DevDigest

Inputs for the `sdd-engineering` plugin. `AGENTS.md` and the package `AGENTS.md` files win
where they disagree with this file.

```yaml
specs_dir: specs
spec_template: specs/TEMPLATE.md
check_command: ".claude/agents/scripts/check-code.sh {package}"
packages:
  - server
  - client
  - reviewer-core
  - mcp
insights_files:
  - INSIGHTS.md
  - server/INSIGHTS.md
  - client/INSIGHTS.md
  - reviewer-core/INSIGHTS.md
  - mcp/INSIGHTS.md
  - e2e/INSIGHTS.md
architecture_docs:
  - README.md
  - server/.dependency-cruiser.cjs
skill_routing: engineering-paved-path:skill-routing
protected_paths:
  - server/clones/**
  - server/package.json
  - "**/pnpm-lock.yaml"
  - "**/package-lock.json"
  - server/drizzle/**
retro_dir: docs/retro/ledger
```
