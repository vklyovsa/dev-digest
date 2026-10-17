#!/usr/bin/env node
// Collects the dependency facts of every package in the repository and prints the
// measured half of the dependency report: totals, two Mermaid diagrams, one table per
// package, the cross-package view, infrastructure pins and the list of signals.
//
//   collect-deps.mjs [--package <dir>]… [--online] [--top <n>] [--json <file>] [--root <dir>]
//
//   --package <dir>  limit the per-package tables to these package folders (repeatable);
//                    the cross-package view still reads every package
//   --online         ask the npm registry for the latest version of every direct dependency
//                    and for known advisories on every installed version; without it nothing
//                    leaves the machine and the Latest / advisory columns stay empty
//   --top <n>        external dependencies drawn per package in the runtime diagram (default 6)
//   --json <file>    where to write the full facts; default is a fresh temp directory,
//                    named on the last line of the output
//
// Reads package.json, the lockfile and node_modules of each package; never runs a package
// manager, so it works the same under pnpm and npm and cannot rewrite a lockfile.
// Sizes are bytes on disk of the installed package, nested node_modules excluded.
// Exit 0 report printed · 3 cannot run · 64 usage.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'clones', 'test-results',
  'playwright-report', 'fixtures', '__fixtures__',
]);
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)(?:test|tests|__tests__)\//;
const CONFIG_FILE = /^(?:\.[^/]+|[^/]+\.config\.[cm]?[jt]s)$/;
const STATIC_IMPORT_RE = /^[ \t]*(?:import\s+|(?:import|export)\b[^'"`;]*?\bfrom\s*)(['"])([^'"\n]+)\1/gm;
const DYNAMIC_IMPORT_RE = /\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1/g;
const CSS_IMPORT_RE = /@(?:import|plugin|config)\s+(['"])([^'"\n]+)\1/g;
const BUILTINS = new Set(builtinModules);
const HEAVY_BYTES = 10 * 1024 * 1024;
const KIND_ORDER = { prod: 0, optional: 1, peer: 2, dev: 3 };
const SEVERITY_ORDER = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

function parseArgs(argv) {
  const opts = { packages: [], online: false, top: 6, json: null, root: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--online') opts.online = true;
    else if (arg === '--package') opts.packages.push(argv[++i]);
    else if (arg === '--top') opts.top = Number(argv[++i]);
    else if (arg === '--json') opts.json = argv[++i];
    else if (arg === '--root') opts.root = argv[++i];
    else usage(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(opts.top) || opts.top < 1) usage('--top needs a positive integer');
  if (opts.packages.some((p) => !p)) usage('--package needs a folder name');
  return opts;
}

function usage(message) {
  console.error(`collect-deps.mjs: ${message}`);
  console.error('usage: collect-deps.mjs [--package <dir>]… [--online] [--top <n>] [--json <file>] [--root <dir>]');
  process.exit(64);
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
  }
}

function findRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function discoverPackages(root) {
  const found = [];
  const visit = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, 'package.json'))) found.push(full);
      else if (depth < 2) visit(full, depth + 1);
    }
  };
  if (fs.existsSync(path.join(root, 'package.json'))) found.push(root);
  visit(root, 1);
  return found.sort();
}

const sizeCache = new Map();
function dirSize(dir) {
  if (sizeCache.has(dir)) return sizeCache.get(dir);
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') stack.push(path.join(current, entry.name));
      } else {
        try {
          total += fs.lstatSync(path.join(current, entry.name)).size;
        } catch {
          // a file removed mid-walk does not change the picture
        }
      }
    }
  }
  sizeCache.set(dir, total);
  return total;
}

function resolveInstalled(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.basename(dir) === 'node_modules'
      ? path.join(dir, name)
      : path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      try {
        return fs.realpathSync(candidate);
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const nodeCache = new Map();
function installedNode(realDir) {
  if (nodeCache.has(realDir)) return nodeCache.get(realDir);
  let manifest = {};
  try {
    manifest = readJson(path.join(realDir, 'package.json'));
  } catch {
    // an unreadable manifest still counts for its size
  }
  const node = {
    dir: realDir,
    name: manifest.name ?? path.basename(realDir),
    version: manifest.version ?? '?',
    license: typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? null,
    bin: manifest.bin ?? null,
    peers: Object.keys(manifest.peerDependencies ?? {}),
    size: dirSize(realDir),
    deps: [],
    peerDeps: [],
  };
  nodeCache.set(realDir, node);
  const hard = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  for (const dep of new Set([...hard, ...node.peers])) {
    const resolved = resolveInstalled(dep, realDir);
    if (!resolved || resolved === realDir) continue;
    (hard.has(dep) ? node.deps : node.peerDeps).push(installedNode(resolved).dir);
  }
  return node;
}

// A peer that the package declares itself is that package's own weight, not the weight of
// whoever asks for it: without `ownRoots`, next-intl would be charged the whole of next.
function closureOf(startDir, ownRoots) {
  const seen = new Set([startDir]);
  const stack = [startDir];
  while (stack.length) {
    const node = nodeCache.get(stack.pop());
    for (const dep of [...node.deps, ...node.peerDeps.filter((dir) => !ownRoots.has(dir))]) {
      if (!seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  return seen;
}

const sumSizes = (dirs) => [...dirs].reduce((total, dir) => total + nodeCache.get(dir).size, 0);

function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function readAliases(pkgDir) {
  const file = path.join(pkgDir, 'tsconfig.json');
  if (!fs.existsSync(file)) return [];
  let config;
  try {
    config = readJson(file);
  } catch {
    return [];
  }
  const base = path.resolve(pkgDir, config.compilerOptions?.baseUrl ?? '.');
  return Object.entries(config.compilerOptions?.paths ?? {}).map(([pattern, targets]) => ({
    pattern,
    prefix: pattern.endsWith('/*') ? pattern.slice(0, -1) : null,
    target: path.resolve(base, String(targets[0]).replace(/\/\*$/, '')),
  }));
}

function matchAlias(aliases, specifier) {
  return aliases.find((alias) => alias.pattern === specifier)
    ?? aliases.find((alias) => alias.prefix && specifier.startsWith(alias.prefix))
    ?? null;
}

function listFiles(pkgDir) {
  const files = [];
  const stack = [pkgDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) stack.push(path.join(current, entry.name));
      } else if (CODE_EXT.test(entry.name) || entry.name.endsWith('.css')) {
        files.push(path.join(current, entry.name));
      }
    }
  }
  return files;
}

function scanImports(pkg, allPackages) {
  const usage = new Map();
  const internal = new Map();
  const touch = (name) => {
    if (!usage.has(name)) usage.set(name, { src: new Set(), test: new Set(), config: new Set(), css: new Set(), strings: new Set() });
    return usage.get(name);
  };
  const ownerOf = (target) => allPackages.find((other) => other.dir !== pkg.dir && (target === other.dir || target.startsWith(other.dir + path.sep)));
  const edge = (key, label, kind, file) => {
    const id = `${kind}:${key}`;
    if (!internal.has(id)) internal.set(id, { to: key, label, kind, example: file, files: new Set() });
    internal.get(id).files.add(file);
  };
  const declared = Object.keys(pkg.declared);

  for (const file of listFiles(pkg.dir)) {
    const rel = path.relative(pkg.dir, file);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const isCss = file.endsWith('.css');
    const bucket = isCss ? 'css' : CONFIG_FILE.test(rel) ? 'config' : TEST_FILE.test(rel) ? 'test' : 'src';
    const matches = isCss ? [...text.matchAll(CSS_IMPORT_RE)] : [...text.matchAll(STATIC_IMPORT_RE), ...text.matchAll(DYNAMIC_IMPORT_RE)];
    for (const match of matches) {
      const specifier = match[2];
      if (specifier.startsWith('node:') || BUILTINS.has(specifier) || /^[a-z]+:/.test(specifier)) continue;
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        if (isCss) continue;
        const owner = ownerOf(path.resolve(path.dirname(file), specifier));
        if (owner) edge(owner.rel, owner.rel, 'relative', rel);
        continue;
      }
      const alias = matchAlias(pkg.aliases, specifier);
      if (alias) {
        const owner = ownerOf(alias.target);
        const label = alias.pattern.replace(/\/\*$/, '');
        if (owner) edge(owner.rel, label, 'alias', rel);
        else if (alias.target.includes(`${path.sep}vendor${path.sep}`)) edge(label, label, 'vendored', rel);
        continue;
      }
      if (!/^[@a-z0-9]/i.test(specifier) || /[\s${}]/.test(specifier)) continue;
      touch(packageNameOf(specifier))[bucket].add(rel);
    }
    if (!isCss) {
      for (const name of declared) {
        if (usage.get(name)?.[bucket].has(rel)) continue;
        if (text.includes(`'${name}'`) || text.includes(`"${name}"`)) touch(name).strings.add(rel);
      }
    }
  }
  return { usage, internal: [...internal.values()].map((e) => ({ ...e, files: e.files.size })) };
}

function readLockDeprecations(pkgDir) {
  const out = new Map();
  const pnpmLock = path.join(pkgDir, 'pnpm-lock.yaml');
  const npmLock = path.join(pkgDir, 'package-lock.json');
  if (fs.existsSync(pnpmLock)) {
    let current = null;
    for (const line of fs.readFileSync(pnpmLock, 'utf8').split('\n')) {
      const key = /^ {2}'?((?:@[^/]+\/)?[^@'\s]+)@([^:'()]+)(?:\([^']*\))?'?:\s*$/.exec(line);
      if (key) current = `${key[1]}@${key[2]}`;
      else if (current && /^ {4}deprecated: /.test(line)) out.set(current, line.replace(/^ {4}deprecated: /, '').replace(/^'|'$/g, ''));
      else if (/^\S/.test(line)) current = null;
    }
  } else if (fs.existsSync(npmLock)) {
    try {
      for (const [key, value] of Object.entries(readJson(npmLock).packages ?? {})) {
        if (!value.deprecated || !key) continue;
        out.set(`${key.slice(key.lastIndexOf('node_modules/') + 13)}@${value.version}`, value.deprecated);
      }
    } catch {
      // an unreadable lockfile is reported through `lockfile: null`
    }
  }
  return out;
}

function binNames(node) {
  if (!node?.bin) return [];
  if (typeof node.bin === 'string') return [node.name.split('/').pop()];
  return Object.keys(node.bin);
}

function analysePackage(pkg, allPackages, repoScriptsText) {
  const { usage, internal } = scanImports(pkg, allPackages);
  const scriptsText = Object.values(pkg.manifest.scripts ?? {}).join('\n');
  const configText = fs.readdirSync(pkg.dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !/^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(e.name) && /\.(json|[cm]?js|ts|ya?ml)$/.test(e.name))
    .map((e) => {
      try {
        return fs.readFileSync(path.join(pkg.dir, e.name), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  const deprecations = readLockDeprecations(pkg.dir);

  const direct = [];
  for (const [name, info] of Object.entries(pkg.declared)) {
    const resolved = resolveInstalled(name, pkg.dir);
    direct.push({ name, ...info, node: resolved ? installedNode(resolved) : null });
  }
  const ownRoots = new Set(direct.filter((d) => d.node).map((d) => d.node.dir));
  for (const dep of direct) dep.closure = dep.node ? closureOf(dep.node.dir, ownRoots) : new Set();

  const reachable = new Set();
  const prodReachable = new Set();
  for (const dep of direct) {
    for (const dir of dep.closure) {
      reachable.add(dir);
      if (dep.kind !== 'dev') prodReachable.add(dir);
    }
  }

  const peerOwners = new Map();
  for (const dep of direct) {
    for (const peer of dep.node?.peers ?? []) {
      if (!peerOwners.has(peer)) peerOwners.set(peer, []);
      peerOwners.get(peer).push(dep.name);
    }
  }

  const rows = direct.map((dep) => {
    const others = new Set();
    for (const other of direct) {
      if (other === dep) continue;
      for (const dir of other.closure) others.add(dir);
    }
    const exclusive = [...dep.closure].filter((dir) => !others.has(dir));
    const used = usage.get(dep.name);
    const bins = binNames(dep.node);
    const binRe = bins.length ? new RegExp(`(^|[\\s/"'=])(${bins.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})($|[\\s"'])`, 'm') : null;
    const how = [];
    if (used?.src.size) how.push(`${used.src.size} src`);
    if (used?.test.size) how.push(`${used.test.size} test`);
    if (used?.config.size) how.push(`${used.config.size} config`);
    if (used?.css.size) how.push(`${used.css.size} css`);
    if (!how.length) {
      if (dep.name.startsWith('@types/')) how.push('types');
      if (binRe?.test(scriptsText)) how.push('cli (package scripts)');
      else if (binRe?.test(repoScriptsText)) how.push('cli (repo scripts / CI)');
      if (configText.includes(`'${dep.name}'`) || configText.includes(`"${dep.name}"`)) how.push('config');
      if (used?.strings.size) how.push(`string ref ×${used.strings.size}`);
      if (peerOwners.has(dep.name)) how.push(`peer of ${peerOwners.get(dep.name).join(', ')}`);
    }
    return {
      name: dep.name,
      kind: dep.kind,
      declared: dep.range,
      installed: dep.node?.version ?? null,
      license: dep.node?.license ?? null,
      ownBytes: dep.node?.size ?? null,
      closureBytes: dep.node ? sumSizes(dep.closure) : null,
      closureCount: dep.node ? dep.closure.size - 1 : null,
      exclusiveBytes: dep.node ? sumSizes(exclusive) : null,
      srcFiles: used?.src.size ?? 0,
      testFiles: used?.test.size ?? 0,
      configFiles: used?.config.size ?? 0,
      cssFiles: used?.css.size ?? 0,
      usage: how.length ? how.join(', ') : 'none found',
      unused: how.length === 0,
      deprecated: dep.node ? deprecations.get(`${dep.name}@${dep.node.version}`) ?? null : null,
      latest: null,
      advisories: [],
    };
  });

  const versionsByName = new Map();
  for (const dir of reachable) {
    const node = nodeCache.get(dir);
    if (!versionsByName.has(node.name)) versionsByName.set(node.name, new Map());
    versionsByName.get(node.name).set(node.version, node.size);
  }
  const duplicates = [...versionsByName.entries()]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, versions: [...versions.keys()].sort(), bytes: [...versions.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.bytes - a.bytes);

  const directNames = new Set(direct.map((d) => d.name));
  const transitiveDeprecated = [];
  for (const dir of reachable) {
    const node = nodeCache.get(dir);
    const message = deprecations.get(`${node.name}@${node.version}`);
    if (!message || directNames.has(node.name)) continue;
    transitiveDeprecated.push({
      name: node.name,
      version: node.version,
      message,
      via: direct.filter((d) => d.closure.has(dir)).map((d) => d.name),
      prod: prodReachable.has(dir),
    });
  }

  const phantoms = [];
  for (const [name, used] of usage) {
    if (directNames.has(name) || name === pkg.manifest.name) continue;
    if (!used.src.size && !used.test.size && !used.config.size && !used.css.size) continue;
    const files = [...used.src, ...used.test, ...used.config, ...used.css];
    phantoms.push({
      name,
      srcFiles: used.src.size,
      testFiles: used.test.size + used.config.size,
      resolves: Boolean(resolveInstalled(name, pkg.dir)),
      example: files[0],
    });
  }

  return {
    name: pkg.manifest.name ?? pkg.rel,
    dir: pkg.rel,
    manager: pkg.manager,
    lockfile: pkg.lockfile,
    installed: fs.existsSync(path.join(pkg.dir, 'node_modules')),
    deps: rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.exclusiveBytes ?? 0) - (a.exclusiveBytes ?? 0)),
    totals: {
      prod: rows.filter((r) => r.kind !== 'dev').length,
      dev: rows.filter((r) => r.kind === 'dev').length,
      installedPackages: reachable.size,
      installedBytes: sumSizes(reachable),
      prodPackages: prodReachable.size,
      prodBytes: sumSizes(prodReachable),
    },
    internal,
    duplicates,
    transitiveDeprecated,
    phantoms: phantoms.sort((a, b) => b.srcFiles - a.srcFiles),
    reachable: [...reachable].map((dir) => {
      const node = nodeCache.get(dir);
      return { name: node.name, version: node.version, prod: prodReachable.has(dir), via: direct.filter((d) => d.closure.has(dir)).map((d) => d.name) };
    }),
  };
}

function loadPackage(dir, root) {
  const manifest = readJson(path.join(dir, 'package.json'));
  const declared = {};
  const add = (block, kind) => {
    for (const [name, range] of Object.entries(manifest[block] ?? {})) declared[name] ??= { kind, range };
  };
  add('dependencies', 'prod');
  add('optionalDependencies', 'optional');
  add('peerDependencies', 'peer');
  add('devDependencies', 'dev');
  const lockfile = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'].find((f) => fs.existsSync(path.join(dir, f))) ?? null;
  return {
    dir,
    rel: path.relative(root, dir) || '.',
    manifest,
    declared,
    lockfile,
    manager: lockfile === 'pnpm-lock.yaml' ? 'pnpm' : lockfile === 'package-lock.json' ? 'npm' : lockfile === 'yarn.lock' ? 'yarn' : 'unknown',
    aliases: readAliases(dir),
  };
}

function hashTree(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  const base = fs.statSync(dir).isDirectory() ? dir : path.dirname(dir);
  const stack = [base];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.set(path.relative(base, full), createHash('sha1').update(fs.readFileSync(full)).digest('hex'));
    }
  }
  return out;
}

function vendoredCopies(packages, root) {
  const byAlias = new Map();
  for (const pkg of packages) {
    for (const alias of pkg.aliases) {
      if (alias.prefix || !alias.target.startsWith(pkg.dir + path.sep) || !alias.target.includes(`${path.sep}vendor${path.sep}`)) continue;
      if (!byAlias.has(alias.pattern)) byAlias.set(alias.pattern, []);
      byAlias.get(alias.pattern).push({ pkg: pkg.rel, dir: fs.statSync(alias.target, { throwIfNoEntry: false })?.isDirectory() ? alias.target : path.dirname(alias.target) });
    }
  }
  const out = [];
  for (const [alias, copies] of byAlias) {
    const entry = { alias, copies: copies.map((c) => ({ package: c.pkg, path: path.relative(root, c.dir) })), differing: [] };
    if (copies.length > 1) {
      const [first, ...rest] = copies.map((c) => hashTree(c.dir));
      const names = new Set([...first.keys(), ...rest.flatMap((m) => [...m.keys()])]);
      for (const name of names) {
        if (rest.some((other) => other.get(name) !== first.get(name))) entry.differing.push(name);
      }
      entry.differing.sort();
    }
    out.push(entry);
  }
  return out;
}

function readInfra(root, packages) {
  const images = [];
  for (const dir of [root, ...packages.map((p) => p.dir)]) {
    for (const file of fs.readdirSync(dir).filter((f) => /^(docker-)?compose.*\.ya?ml$/.test(f) || /^Dockerfile/.test(f))) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of text.matchAll(/^\s*(?:image:|FROM)\s+["']?([^\s"']+)/gm)) {
        images.push({ file: path.relative(root, path.join(dir, file)), image: match[1] });
      }
    }
  }
  const actions = new Map();
  const workflows = path.join(root, '.github', 'workflows');
  if (fs.existsSync(workflows)) {
    for (const file of fs.readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
      for (const match of fs.readFileSync(path.join(workflows, file), 'utf8').matchAll(/^\s*-?\s*uses:\s*["']?([^\s"'#]+)/gm)) {
        if (!actions.has(match[1])) actions.set(match[1], new Set());
        actions.get(match[1]).add(file);
      }
    }
  }
  return {
    images,
    actions: [...actions.entries()].map(([ref, files]) => ({ ref, workflows: files.size, pinnedToSha: /@[0-9a-f]{40}$/.test(ref) })).sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}

function readRepoScripts(root) {
  const chunks = [];
  const take = (dir, pattern, depth = 0) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 4 && !SKIP_DIRS.has(entry.name) && !entry.name.endsWith('-workspace')) take(full, pattern, depth + 1);
      } else if (pattern.test(entry.name)) {
        try {
          chunks.push(fs.readFileSync(full, 'utf8'));
        } catch {
          // unreadable script: nothing to match against
        }
      }
    }
  };
  take(path.join(root, 'scripts'), /\.(sh|[cm]?js|ts)$/);
  take(path.join(root, '.github'), /\.ya?ml$/);
  take(path.join(root, '.claude'), /\.sh$/);
  return chunks.join('\n');
}

function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(text).trim());
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], pre: match[4] ?? null };
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] < b.parts[i] ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

function satisfies(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const normalised = String(range).replace(/,/g, ' ').replace(/([<>=]+)\s+/g, '$1');
  return normalised.split('||').some((alternative) => {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    if (!comparators.length) return true;
    return comparators.every((comparator) => {
      if (comparator === '*' || comparator === 'x') return true;
      const match = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator);
      const bound = parseVersion(match[2]);
      if (!bound) return false;
      const order = compareVersions(parsed, bound);
      switch (match[1] ?? '=') {
        case '>=': return order >= 0;
        case '<=': return order <= 0;
        case '>': return order > 0;
        case '<': return order < 0;
        default: return order === 0;
      }
    });
  });
}

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

async function goOnline(reports) {
  const errors = [];
  const latest = new Map();
  const names = [...new Set(reports.flatMap((r) => r.deps.map((d) => d.name)))];
  await mapLimit(names, 8, async (name) => {
    try {
      const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      latest.set(name, (await response.json())['dist-tags']?.latest ?? null);
    } catch (error) {
      errors.push(`latest ${name}: ${error.message}`);
    }
  });

  const installed = {};
  for (const report of reports) {
    for (const item of report.reachable) (installed[item.name] ??= new Set()).add(item.version);
  }
  const body = Object.fromEntries(Object.entries(installed).map(([name, versions]) => [name, [...versions]]));
  let advisories = {};
  try {
    const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    advisories = await response.json();
  } catch (error) {
    errors.push(`advisories: ${error.message}`);
  }

  for (const report of reports) {
    report.advisories = [];
    for (const dep of report.deps) {
      dep.latest = latest.get(dep.name) ?? null;
      const now = parseVersion(dep.installed ?? '');
      const next = parseVersion(dep.latest ?? '');
      dep.majorsBehind = now && next ? Math.max(0, next.parts[0] - now.parts[0]) : null;
      dep.behind = now && next ? compareVersions(now, next) < 0 : null;
    }
    for (const item of report.reachable) {
      for (const advisory of advisories[item.name] ?? []) {
        if (!satisfies(item.version, advisory.vulnerable_versions)) continue;
        report.advisories.push({
          name: item.name,
          version: item.version,
          severity: advisory.severity,
          title: advisory.title,
          url: advisory.url,
          range: advisory.vulnerable_versions,
          prod: item.prod,
          via: item.via,
        });
      }
    }
    report.advisories.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || Number(b.prod) - Number(a.prod));
  }
  return errors;
}

function crossPackage(reports) {
  const byName = new Map();
  for (const report of reports) {
    for (const dep of report.deps) {
      if (!byName.has(dep.name)) byName.set(dep.name, []);
      byName.get(dep.name).push({ package: report.dir, kind: dep.kind, declared: dep.declared, installed: dep.installed });
    }
  }
  const shared = [...byName.entries()]
    .filter(([, uses]) => uses.length > 1)
    .map(([name, uses]) => {
      const installed = new Set(uses.map((u) => u.installed).filter(Boolean));
      const majors = new Set([...installed].map((v) => parseVersion(v)?.parts[0]));
      return {
        name,
        uses,
        drift: majors.size > 1 ? 'major' : installed.size > 1 ? 'minor/patch' : new Set(uses.map((u) => u.declared)).size > 1 ? 'range only' : 'none',
      };
    })
    .sort((a, b) => b.uses.length - a.uses.length || a.name.localeCompare(b.name));
  return shared;
}

function buildSignals(reports, shared, vendored, infra, online) {
  const signals = [];
  const add = (rule, pkg, subject, evidence) => signals.push({ rule, package: pkg, subject, evidence });
  for (const report of reports) {
    if (!report.lockfile) add('NO-LOCKFILE', report.dir, '—', 'no lockfile next to package.json');
    if (!report.installed) add('NOT-INSTALLED', report.dir, '—', 'no node_modules: sizes, versions and transitives are unknown');
    const grouped = new Map();
    for (const advisory of report.advisories ?? []) {
      const key = `${advisory.name}@${advisory.version}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(advisory);
    }
    const minor = [];
    const devHigh = [];
    for (const [subject, list] of grouped) {
      const worst = list[0];
      if ((SEVERITY_ORDER[worst.severity] ?? 9) > SEVERITY_ORDER.high) {
        minor.push(subject);
        continue;
      }
      if (worst.severity === 'high' && !worst.prod) {
        devHigh.push(`${subject} (via ${worst.via.join(', ')})`);
        continue;
      }
      add('VULN', report.dir, subject, `${worst.severity}, ${worst.prod ? 'runtime' : 'dev-only'} tree, via ${worst.via.join(', ')} — ${worst.title} (${worst.url}), affected ${worst.range}${list.length > 1 ? `; ${list.length - 1} more on this version` : ''}`);
    }
    if (devHigh.length) add('VULN-DEV', report.dir, `${devHigh.length} packages`, `high advisories in the dev-only tree: ${devHigh.join('; ')}`);
    if (minor.length) add('VULN-MINOR', report.dir, `${minor.length} packages`, `moderate or low advisories only: ${minor.slice(0, 6).join(', ')}${minor.length > 6 ? ', …' : ''} — full list in the facts file`);
    for (const edge of report.internal) {
      if (edge.kind === 'relative') add('CROSS-PACKAGE-RELATIVE', report.dir, `${edge.to}/`, `${files(edge.files)} reach${edge.files === 1 ? 'es' : ''} into ${edge.to}/ by relative path instead of its alias or entry point (e.g. ${edge.example})`);
    }
    for (const phantom of report.phantoms) {
      add('PHANTOM', report.dir, phantom.name, `imported in ${phantom.srcFiles} src / ${phantom.testFiles} test or config files (e.g. ${phantom.example}), not in package.json; ${phantom.resolves ? 'resolves today through another package' : 'does not resolve from this package'}`);
    }
    for (const dep of report.deps) {
      if (report.installed && !dep.installed) add('MISSING', report.dir, dep.name, `declared ${dep.declared}, not in node_modules`);
      if (dep.unused) add('UNUSED', report.dir, dep.name, `${dep.kind === 'prod' ? 'runtime' : dep.kind}, no import, CLI, config or string reference found; removal frees ${formatBytes(dep.exclusiveBytes)}`);
      if (dep.kind === 'prod' && !dep.srcFiles && !dep.cssFiles && (dep.testFiles || dep.configFiles || /^cli|^types/.test(dep.usage))) {
        add('PROD-NOT-RUNTIME', report.dir, dep.name, `in dependencies, used as: ${dep.usage}`);
      }
      if (dep.kind === 'dev' && dep.srcFiles) add('DEV-IN-SRC', report.dir, dep.name, `in devDependencies, imported by ${files(dep.srcFiles)} outside tests and config`);
      if (dep.deprecated) add('DEPRECATED', report.dir, `${dep.name}@${dep.installed}`, `direct ${dep.kind === 'prod' ? 'runtime' : dep.kind} dependency — ${dep.deprecated}`);
      if (dep.kind !== 'dev' && (dep.exclusiveBytes ?? 0) >= HEAVY_BYTES && dep.srcFiles <= 2) {
        add('HEAVY-LOW-USE', report.dir, dep.name, `${formatBytes(dep.exclusiveBytes)} only this dependency brings, imported by ${files(dep.srcFiles)} of source`);
      }
      if (online && dep.majorsBehind && dep.kind !== 'dev') add('OUTDATED-MAJOR', report.dir, dep.name, `${dep.kind === 'prod' ? 'runtime' : dep.kind}, installed ${dep.installed}, latest ${dep.latest} (${dep.majorsBehind} major behind)`);
      if (/^(\*|latest|x)$/.test(dep.declared) || /^(git|https?|file|link):/.test(dep.declared)) add('LOOSE-RANGE', report.dir, dep.name, `declared as ${dep.declared}`);
    }
    const staleDev = report.deps.filter((d) => online && d.kind === 'dev' && d.majorsBehind);
    if (staleDev.length) add('OUTDATED-MAJOR-DEV', report.dir, `${staleDev.length} dev dependencies`, staleDev.map((d) => `${d.name} ${d.installed} → ${d.latest}`).join(', '));
    for (const item of report.transitiveDeprecated) {
      add('DEPRECATED-TRANSITIVE', report.dir, `${item.name}@${item.version}`, `${item.prod ? 'runtime' : 'dev-only'} tree, via ${item.via.join(', ')} — ${item.message}`);
    }
    const duplicateBytes = report.duplicates.reduce((total, d) => total + d.bytes, 0);
    if (report.duplicates.length) {
      add('DUPLICATES', report.dir, `${report.duplicates.length} packages`, `installed in 2+ versions, ${formatBytes(duplicateBytes)} together; largest: ${report.duplicates.slice(0, 3).map((d) => `${d.name} (${d.versions.join(', ')})`).join('; ')}`);
    }
  }
  for (const item of shared) {
    if (item.drift === 'none') continue;
    if (item.drift === 'range only' && item.uses.every((u) => u.kind === 'dev')) continue;
    add('VERSION-DRIFT', item.uses.map((u) => u.package).join(', '), item.name, `${item.drift}: ${item.uses.map((u) => `${u.package} ${u.declared} → ${u.installed ?? 'not installed'}`).join(' · ')}`);
  }
  for (const item of vendored) {
    if (item.differing.length) add('VENDORED-DRIFT', item.copies.map((c) => c.package).join(', '), item.alias, `${files(item.differing.length)} differ${item.differing.length === 1 ? 's' : ''} between the copies, e.g. ${item.differing.slice(0, 3).join(', ')}`);
  }
  for (const action of infra.actions) {
    if (!action.pinnedToSha && !action.ref.startsWith('./')) add('ACTION-TAG', '.github', action.ref, `pinned to a tag, workflows using it: ${action.workflows}`);
  }
  for (const image of infra.images) {
    if (!image.image.includes('@sha256:')) add('IMAGE-TAG', image.file, image.image, 'pinned to a tag, not a digest');
  }
  return signals.map((signal, index) => ({ id: `S${String(index + 1).padStart(2, '0')}`, ...signal }));
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

const files = (count) => `${count} ${count === 1 ? 'file' : 'files'}`;
const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const nodeId = (text) => text.replace(/[^A-Za-z0-9]/g, '_');

function renderRepoMap(reports, vendored) {
  const lines = ['```mermaid', 'flowchart LR'];
  for (const report of reports) {
    lines.push(`  ${nodeId(report.dir)}["<b>${report.dir}/</b><br/>${report.name}<br/>${report.totals.prod} runtime · ${report.totals.dev} dev<br/>${formatBytes(report.totals.installedBytes)} installed"]`);
  }
  for (const item of vendored) {
    for (const copy of item.copies) {
      lines.push(`  ${nodeId(`v_${copy.package}_${item.alias}`)}[/"${item.alias}<br/>vendored in ${copy.package}/"/]`);
    }
  }
  for (const report of reports) {
    for (const edge of report.internal) {
      if (edge.kind === 'vendored') {
        lines.push(`  ${nodeId(report.dir)} -->|"${files(edge.files)}"| ${nodeId(`v_${report.dir}_${edge.label}`)}`);
      } else {
        lines.push(`  ${nodeId(report.dir)} ==>|"${edge.kind === 'alias' ? edge.label : 'relative import'} · ${files(edge.files)}"| ${nodeId(edge.to)}`);
      }
    }
  }
  for (const item of vendored) {
    if (item.copies.length < 2) continue;
    const [first, ...rest] = item.copies;
    for (const other of rest) {
      lines.push(`  ${nodeId(`v_${first.package}_${item.alias}`)} -.-|"${item.differing.length ? `${item.differing.length} files differ` : 'identical copies'}"| ${nodeId(`v_${other.package}_${item.alias}`)}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}

function renderRuntimeMap(reports, shared, top) {
  const lines = ['```mermaid', 'flowchart LR'];
  const sharedRuntime = new Set(shared.filter((s) => s.uses.filter((u) => u.kind !== 'dev').length > 1).map((s) => s.name));
  const drawn = new Map();
  const edges = [];
  for (const report of reports) {
    const runtime = report.deps.filter((d) => d.kind !== 'dev');
    if (!runtime.length) continue;
    const heaviest = [...runtime].sort((a, b) => (b.closureBytes ?? 0) - (a.closureBytes ?? 0)).slice(0, top);
    const chosen = new Set([...heaviest, ...runtime.filter((d) => sharedRuntime.has(d.name))]);
    lines.push(`  ${nodeId(report.dir)}["<b>${report.dir}/</b>"]`);
    for (const dep of chosen) {
      const isShared = sharedRuntime.has(dep.name);
      const id = isShared ? nodeId(`d_${dep.name}`) : nodeId(`d_${report.dir}_${dep.name}`);
      if (!drawn.has(id)) drawn.set(id, isShared ? `  ${id}(["${dep.name}"])` : `  ${id}("${dep.name}<br/>${formatBytes(dep.closureBytes)}")`);
      edges.push(`  ${nodeId(report.dir)} -->|"${dep.installed ?? '?'}"| ${id}`);
    }
    const hidden = runtime.length - chosen.size;
    if (hidden > 0) {
      const id = nodeId(`more_${report.dir}`);
      drawn.set(id, `  ${id}["+${hidden} more"]:::muted`);
      edges.push(`  ${nodeId(report.dir)} --- ${id}`);
    }
  }
  lines.push(...drawn.values(), ...edges, '  classDef muted stroke-dasharray: 4 4', '```');
  return lines.join('\n');
}

function renderMarkdown(facts, opts) {
  const { reports, shared, vendored, infra, signals } = facts;
  const selected = opts.packages.length ? reports.filter((r) => opts.packages.includes(r.dir)) : reports;
  const out = [];
  out.push(`# Dependency report — ${facts.repo}`);
  out.push('');
  out.push('## 1. Scope');
  out.push('');
  out.push(`- **Snapshot:** \`${facts.commit}\` on \`${facts.branch}\`, ${facts.date}`);
  out.push(`- **Mode:** ${facts.online ? 'online — latest versions and advisories from the npm registry' : 'offline — no registry data, so no "latest" and no advisories'}`);
  out.push(`- **Detailed:** ${opts.packages.length ? selected.map((r) => `\`${r.dir}/\``).join(', ') : 'every package'} · cross-package view always covers every package`);
  out.push('- **Read:** `package.json`, lockfile, installed `node_modules`, source imports, `tsconfig.json` path aliases, compose files, GitHub workflows');
  out.push(`- **Not covered:** browser bundle size (sizes below are disk size of the install) · runtime coupling over HTTP between packages · dependencies loaded through a computed name${facts.online ? '' : ' · advisories and latest versions (run with `online`)'}`);
  out.push('');
  out.push('| Package | Manager | Runtime deps | Dev deps | Installed packages | Installed size | Runtime-only size | Signals |');
  out.push('|---|---|--:|--:|--:|--:|--:|--:|');
  for (const report of reports) {
    const count = signals.filter((s) => s.package.split(', ').includes(report.dir)).length;
    out.push(`| \`${report.dir}/\` ${cell(report.name)} | ${report.manager} | ${report.totals.prod} | ${report.totals.dev} | ${report.totals.installedPackages} | ${formatBytes(report.totals.installedBytes)} | ${formatBytes(report.totals.prodBytes)} | ${count} |`);
  }
  out.push('');
  out.push('## 2. Dependency graph');
  out.push('');
  out.push('### 2.1 Internal — which package imports which');
  out.push('');
  out.push(renderRepoMap(reports, vendored));
  out.push('');
  const internalRows = reports.flatMap((report) => report.internal.map((edge) => `| \`${report.dir}\` | ${edge.kind === 'vendored' ? `\`${edge.label}\` (vendored copy in \`${report.dir}\`)` : `\`${edge.to}\``} | ${edge.kind === 'relative' ? '**relative path**' : `\`${edge.label}\` path alias`} | ${edge.files} |`));
  if (internalRows.length) {
    out.push('| From | To | Through | Importing files |');
    out.push('|---|---|---|--:|');
    out.push(...internalRows);
  } else {
    out.push('No package imports another package.');
  }
  for (const item of vendored.filter((v) => v.copies.length > 1)) {
    out.push('');
    out.push(`\`${item.alias}\` exists as ${item.copies.length} copies (${item.copies.map((c) => `\`${c.path}\``).join(', ')}): ${item.differing.length ? `**${item.differing.length} files differ** — ${item.differing.slice(0, 8).map((f) => `\`${f}\``).join(', ')}${item.differing.length > 8 ? ', …' : ''}` : 'byte-identical'}.`);
  }
  out.push('');
  out.push(`### 2.2 External — shared runtime dependencies and the ${opts.top} heaviest per package`);
  out.push('');
  out.push(renderRuntimeMap(reports, shared, opts.top));
  out.push('');
  out.push('Rounded nodes are declared by two or more packages; an edge label is the installed version; sizes include transitives.');
  out.push('');
  out.push('## 3. Size breakdown');
  out.push('');
  out.push('**Own** — the package folder itself. **With transitives** — plus everything it pulls in. **Only this brings** — what leaves `node_modules` if this one dependency is removed.');
  for (const report of selected) {
    out.push('');
    out.push(`### 3.${selected.indexOf(report) + 1} \`${report.dir}/\` — ${report.name}`);
    out.push('');
    if (!report.installed) {
      out.push('`node_modules` is missing: install the package before trusting sizes or versions.');
      out.push('');
    }
    const header = ['Dependency', 'Type', 'Declared', 'Installed'];
    if (facts.online) header.push('Latest');
    header.push('Own', 'With transitives', 'Only this brings', 'Transitive pkgs', 'Used by', 'License');
    out.push(`| ${header.join(' | ')} |`);
    out.push(`|${header.map((h) => (/^(Own|With|Only|Transitive)/.test(h) ? '--:' : '---')).join('|')}|`);
    for (const dep of report.deps) {
      const row = [`\`${dep.name}\``, dep.kind === 'prod' ? 'runtime' : dep.kind, cell(dep.declared), cell(dep.installed ?? 'not installed')];
      if (facts.online) row.push(dep.latest ? (dep.behind ? `**${dep.latest}**` : dep.latest) : '—');
      row.push(formatBytes(dep.ownBytes), formatBytes(dep.closureBytes), formatBytes(dep.exclusiveBytes), dep.closureCount ?? '—', cell(dep.usage), cell(dep.license));
      out.push(`| ${row.join(' | ')} |`);
    }
  }
  const next = selected.length + 1;
  out.push('');
  out.push(`### 3.${next} Declared by two or more packages`);
  out.push('');
  if (shared.length) {
    out.push(`| Dependency | ${reports.map((r) => `\`${r.dir}\``).join(' | ')} | Drift |`);
    out.push(`|---|${reports.map(() => '---').join('|')}|---|`);
    for (const item of shared) {
      const cells = reports.map((report) => {
        const use = item.uses.find((u) => u.package === report.dir);
        return use ? `${cell(use.installed ?? '—')} (${cell(use.declared)}${use.kind === 'dev' ? ', dev' : ''})` : '';
      });
      out.push(`| \`${item.name}\` | ${cells.join(' | ')} | ${item.drift === 'none' ? '—' : `**${item.drift}**`} |`);
    }
  } else {
    out.push('None.');
  }
  out.push('');
  out.push(`### 3.${next + 1} Infrastructure`);
  out.push('');
  out.push('| Kind | Reference | Where | Pinned to |');
  out.push('|---|---|---|---|');
  for (const image of infra.images) out.push(`| Docker image | \`${image.image}\` | \`${image.file}\` | ${image.image.includes('@sha256:') ? 'digest' : 'tag'} |`);
  for (const action of infra.actions) out.push(`| GitHub Action | \`${action.ref}\` | workflows: ${action.workflows} | ${action.pinnedToSha ? 'commit' : 'tag'} |`);
  out.push('');
  out.push('<!-- SIGNALS: input for sections 4 and 5. Verify each one, then drop this block from the report. -->');
  out.push('');
  if (signals.length) {
    out.push('| ID | Rule | Package | Subject | Evidence |');
    out.push('|---|---|---|---|---|');
    for (const signal of signals) out.push(`| ${signal.id} | ${signal.rule} | ${cell(signal.package)} | \`${cell(signal.subject)}\` | ${cell(signal.evidence)} |`);
  } else {
    out.push('No rule fired.');
  }
  if (facts.onlineErrors.length) {
    out.push('');
    out.push(`Registry errors (${facts.onlineErrors.length}): ${facts.onlineErrors.slice(0, 5).map(cell).join('; ')}`);
  }
  return out.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = findRoot(opts.root);
  if (!fs.existsSync(root)) {
    console.error(`collect-deps.mjs: ${root} does not exist`);
    process.exit(3);
  }
  const packages = discoverPackages(root).map((dir) => loadPackage(dir, root));
  if (!packages.length) {
    console.error(`collect-deps.mjs: no package.json found under ${root}`);
    process.exit(3);
  }
  const unknown = opts.packages.filter((name) => !packages.some((p) => p.rel === name));
  if (unknown.length) usage(`no such package folder: ${unknown.join(', ')} (have: ${packages.map((p) => p.rel).join(', ')})`);

  const repoScriptsText = readRepoScripts(root);
  const reports = packages.map((pkg) => analysePackage(pkg, packages, repoScriptsText));
  const onlineErrors = opts.online ? await goOnline(reports) : [];
  const shared = crossPackage(reports);
  const vendored = vendoredCopies(packages, root);
  const infra = readInfra(root, packages);
  const signals = buildSignals(reports, shared, vendored, infra, opts.online);

  const git = (...args) => {
    try {
      return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return 'unknown';
    }
  };
  const facts = {
    repo: path.basename(root),
    commit: git('rev-parse', '--short', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    date: new Date().toLocaleDateString('sv-SE'),
    online: opts.online,
    onlineErrors,
    reports,
    shared,
    vendored,
    infra,
    signals,
  };

  const jsonFile = opts.json ? path.resolve(opts.json) : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-checker.')), 'facts.json');
  fs.writeFileSync(jsonFile, JSON.stringify(facts, null, 2));
  console.log(renderMarkdown(facts, opts));
  console.log('');
  console.log(`<!-- facts: ${jsonFile} -->`);
}

main().catch((error) => {
  console.error(`collect-deps.mjs: ${error.stack ?? error.message}`);
  process.exit(3);
});
