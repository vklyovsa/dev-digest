import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsRepoDocsReader } from '../src/adapters/index.js';
import { classifyDocuments, docTokens } from '../src/modules/context/helpers.js';
import { DEFAULT_CONTEXT_ROOTS } from '../src/platform/config.js';

const TREE: Record<string, string> = {
  'specs/a.md': '# a',
  'specs/deep/er/b.md': '# b',
  'docs/c.md': '# c',
  'docs/nested/d.md': '# d',
  'docs/specs/x.md': '# x',
  'insights/e.md': '# e',
  'insights/sub/f.md': '# f',
  'adr/g.md': '# g',
  'README.md': '# readme',
  'src/notes.md': '# notes',
  'docs/notes.txt': 'not markdown',
  'specs/data.json': '{}',
  '.devdigest/specs/a.md': '# hidden',
  '.github/docs/b.md': '# hidden',
  'docs/.private/h.md': '# hidden',
  'docs/.hidden.md': '# hidden file',
};

describe('project context document discovery', () => {
  let base: string;
  let clone: string;
  let outside: string;
  const reader = new FsRepoDocsReader();

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'devdigest-ctx-'));
    clone = join(base, 'clone');
    outside = join(base, 'outside');
    await mkdir(clone, { recursive: true });
    await mkdir(join(outside, 'dir'), { recursive: true });
    for (const [rel, text] of Object.entries(TREE)) {
      await mkdir(join(clone, rel, '..'), { recursive: true });
      await writeFile(join(clone, rel), text);
    }
    await writeFile(join(outside, 'x.md'), '# secret outside the clone');
    await writeFile(join(outside, 'dir', 'o.md'), '# in an outside directory');
    await writeFile(join(clone, '.devdigest', 'secret.txt'), 'token');
    await symlink(join(outside, 'x.md'), join(clone, 'docs', 'escape.md'));
    await symlink(join(outside, 'dir'), join(clone, 'docs', 'linked-dir'));
    await symlink(join(clone, 'specs', 'a.md'), join(clone, 'docs', 'inside-link.md'));
    await symlink(join(clone, '.devdigest', 'secret.txt'), join(clone, 'docs', 'dot-link.md'));
    await symlink(join(base, 'does-not-exist'), join(clone, 'docs', 'dangling.md'));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function documents(roots: readonly string[] = DEFAULT_CONTEXT_ROOTS) {
    return classifyDocuments(await reader.listMarkdown(clone), roots);
  }

  it('lists Markdown under the default roots at any depth and nothing else (AC-2)', async () => {
    const paths = (await documents()).map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'specs/a.md',
        'specs/deep/er/b.md',
        'docs/c.md',
        'docs/nested/d.md',
        'insights/e.md',
        'insights/sub/f.md',
      ]),
    );
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('src/notes.md');
    expect(paths).not.toContain('adr/g.md');
    expect(paths).not.toContain('docs/notes.txt');
    expect(paths).not.toContain('specs/data.json');
  });

  it('follows a custom root list (AC-2)', async () => {
    const docs = await documents(['adr']);
    expect(docs).toEqual([{ path: 'adr/g.md', type: 'adr' }]);
  });

  it('leaves out every file inside a dot-directory (AC-3)', async () => {
    const paths = (await documents()).map((d) => d.path);
    expect(paths).not.toContain('.devdigest/specs/a.md');
    expect(paths).not.toContain('.github/docs/b.md');
    expect(paths).not.toContain('docs/.private/h.md');
    expect(await reader.listMarkdown(clone)).not.toContain('docs/.hidden.md');
  });

  it('classifies a path by the first root folder from the repository root (AC-4)', async () => {
    const byPath = new Map((await documents()).map((d) => [d.path, d.type]));
    expect(byPath.get('docs/specs/x.md')).toBe('docs');
    expect(byPath.get('specs/a.md')).toBe('specs');
    expect(byPath.get('insights/sub/f.md')).toBe('insights');
  });

  it('orders by root position and then by path (AC-5)', async () => {
    expect((await documents()).map((d) => d.path)).toEqual([
      'specs/a.md',
      'specs/deep/er/b.md',
      'docs/c.md',
      'docs/inside-link.md',
      'docs/nested/d.md',
      'docs/specs/x.md',
      'insights/e.md',
      'insights/sub/f.md',
    ]);
    expect((await documents(['insights', 'specs'])).map((d) => d.path)).toEqual([
      'insights/e.md',
      'insights/sub/f.md',
      'docs/specs/x.md',
      'specs/a.md',
      'specs/deep/er/b.md',
    ]);
  });

  it('estimates tokens as characters over four, rounded up (AC-50)', () => {
    expect(docTokens('0123456789')).toBe(3);
    expect(docTokens('')).toBe(0);
    expect(docTokens('abcd')).toBe(1);
  });

  it('lists a .md link only when it resolves to a regular file inside the clone (EC-5, NFR-3)', async () => {
    const listed = await reader.listMarkdown(clone);
    expect(listed).toContain('docs/inside-link.md');
    expect(listed).not.toContain('docs/escape.md');
    expect(listed).not.toContain('docs/dot-link.md');
    expect(listed).not.toContain('docs/dangling.md');
    expect(listed.some((p) => p.startsWith('docs/linked-dir/'))).toBe(false);
  });

  it('never reads outside the clone (EC-5, NFR-3)', async () => {
    expect(await reader.readText(clone, '../outside/x.md')).toBeNull();
    expect(await reader.readText(clone, 'docs/../../outside/x.md')).toBeNull();
    expect(await reader.readText(clone, 'docs/escape.md')).toBeNull();
    expect(await reader.readText(clone, 'docs/linked-dir/o.md')).toBeNull();
    expect(await reader.readText(clone, 'docs/dot-link.md')).toBeNull();
    expect(await reader.readText(clone, '.devdigest/secret.txt')).toBeNull();
    expect(await reader.readText(clone, join(outside, 'x.md'))).toBeNull();
  });

  it('refuses an empty, absolute, backslash or NUL path', async () => {
    expect(await reader.readText(clone, '')).toBeNull();
    expect(await reader.readText(clone, '/docs/c.md')).toBeNull();
    expect(await reader.readText(clone, 'docs\\c.md')).toBeNull();
    expect(await reader.readText(clone, 'docs/c.md\0')).toBeNull();
  });

  it('reads a listed file and a link to a file inside the clone', async () => {
    expect(await reader.readText(clone, 'docs/c.md')).toBe('# c');
    expect(await reader.readText(clone, 'docs/inside-link.md')).toBe('# a');
  });

  it('answers null for a missing file or a directory', async () => {
    expect(await reader.readText(clone, 'docs/missing.md')).toBeNull();
    expect(await reader.readText(clone, 'docs')).toBeNull();
  });

  it('answers an empty list and null for a clone that is not on disk (AC-8)', async () => {
    const gone = join(base, 'no-such-clone');
    expect(await reader.listMarkdown(gone)).toEqual([]);
    expect(await reader.readText(gone, 'docs/c.md')).toBeNull();
  });
});

describe('classifyDocuments', () => {
  it('drops a path that is not Markdown, has no root folder, or sits in a dot-directory', () => {
    expect(
      classifyDocuments(
        ['docs/a.md', 'docs/a.txt', 'a.md', 'src/a.md', '.docs/a.md', 'docs/.x/a.md', 'docs/A.MD'],
        ['docs'],
      ),
    ).toEqual([{ path: 'docs/a.md', type: 'docs' }]);
  });

  it('does not treat a file named like a root as a root folder', () => {
    expect(classifyDocuments(['docs.md', 'a/docs'], ['docs'])).toEqual([]);
  });

  it('compares paths by code unit, so upper case sorts before lower case', () => {
    expect(
      classifyDocuments(['docs/b.md', 'docs/B.md', 'docs/a.md'], ['docs']).map((d) => d.path),
    ).toEqual(['docs/B.md', 'docs/a.md', 'docs/b.md']);
  });
});
