/**
 * Architecture rules for @devdigest/mcp — the layer map in mcp/AGENTS.md.
 * Design reference: `.claude/skills/onion-architecture/` (its enforced scope is server/ and
 * reviewer-core/; here the same dependency rule is held by this file). Run `npm run arch:check`.
 *
 * Rings, inside out:
 *   domain       text, findings, resolve, constants
 *   ports        ports, errors
 *   use cases    tools/
 *   adapters     api/ (driven), log
 *   surface      definitions, result, server (driving, the only SDK users with index)
 *   root         index, config
 *
 * Tests and src/testing/ are left out of the graph: they may import anything.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */

const DOMAIN = '^src/(text|findings|resolve|constants)\\.ts$';
const PORTS = '^src/(ports|errors)\\.ts$';
const SURFACE_AND_ROOT = '^src/(definitions|result|server|index|config)\\.ts$';

module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      comment:
        'The domain imports only itself, ports.ts and errors.ts: no adapter, use case, surface or root file, no npm package, no node builtin.',
      severity: 'error',
      from: { path: DOMAIN },
      to: { pathNot: `${DOMAIN}|${PORTS}` },
    },
    {
      name: 'use-cases-through-ports',
      comment:
        'A use case takes the DevDigestApi port as an argument. It imports the domain, ports.ts, errors.ts and other use cases, never src/api/, the surface, the root, an npm package or a node builtin.',
      severity: 'error',
      from: { path: '^src/tools/' },
      to: { pathNot: `${DOMAIN}|${PORTS}|^src/tools/` },
    },
    {
      name: 'adapter-not-to-use-cases',
      comment: 'The driven adapter is outer: it must not reach use cases, the surface or the root.',
      severity: 'error',
      from: { path: '^src/api/' },
      to: { path: `^src/tools/|${SURFACE_AND_ROOT}` },
    },
    {
      name: 'only-root-wires-adapters',
      comment:
        'index.ts is the only place that constructs HttpDevDigestApi; everything else receives the port.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/(index\\.ts$|api/)' },
      to: { path: '^src/api/' },
    },
    {
      // Matched on the RESOLVED path (node_modules/@modelcontextprotocol/...), not the specifier;
      // an unresolved import keeps its bare specifier, hence the alternative at the start.
      name: 'sdk-only-in-surface',
      comment:
        'The MCP SDK is the transport. Only definitions.ts, result.ts, server.ts and index.ts import it.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/(definitions|result|server|index)\\.ts$' },
      to: { path: '(^|node_modules/)@modelcontextprotocol/' },
    },
    {
      name: 'no-circular',
      comment: 'A cycle means two things that should be one, or a missing port.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.test\\.ts$|^src/testing/)' },
    tsConfig: { fileName: 'tsconfig.json' },
    // The package is ESM: ./service.js is written for service.ts. Without this the local
    // graph resolves to nothing and every rule passes vacuously.
    tsPreCompilationDeps: true,
    // The SDK maps "./*" to { types: "./dist/esm/*.d.ts", import: "./dist/esm/*" }. With the
    // default "types" condition enhanced-resolve takes the first key, appends ".d.ts" to
    // "server/mcp.js", finds nothing and leaves the import unresolved.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
