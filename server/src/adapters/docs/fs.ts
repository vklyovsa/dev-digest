import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { RepoDocsReader } from '@devdigest/shared';

const MARKDOWN_SUFFIX = '.md';

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** A resolved path may not pass through a dot entry (`.git`, `.devdigest`, …) under the clone root. */
function hasDotSegment(root: string, target: string): boolean {
  return relative(root, target)
    .split(sep)
    .some((segment) => segment.startsWith('.'));
}

function isRejectedRelPath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path) || path.startsWith('/')) return true;
  if (path.includes('\\') || path.includes('\0')) return true;
  return path.split('/').some((segment) => segment === '..');
}

/**
 * Reads Markdown from a clone's working tree. The clone is repository-controlled
 * input: a path or a symbolic link inside it must never lead the read outside it.
 */
export class FsRepoDocsReader implements RepoDocsReader {
  async listMarkdown(clonePath: string): Promise<string[]> {
    let root: string;
    try {
      root = await realpath(clonePath);
    } catch {
      return [];
    }
    const out: string[] = [];
    await this.walk(root, root, '', out);
    return out;
  }

  async readText(clonePath: string, relPath: string): Promise<string | null> {
    if (isRejectedRelPath(relPath)) return null;
    try {
      const root = await realpath(clonePath);
      const real = await realpath(join(root, relPath));
      if (!isInside(root, real) || hasDotSegment(root, real)) return null;
      if (!(await stat(real)).isFile()) return null;
      return await readFile(real, 'utf8');
    } catch {
      return null;
    }
  }

  private async walk(root: string, dir: string, prefix: string, out: string[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.')) continue;
      const rel = prefix === '' ? name : `${prefix}/${name}`;

      if (entry.isDirectory()) {
        await this.walk(root, join(dir, name), rel, out);
        continue;
      }
      if (!name.endsWith(MARKDOWN_SUFFIX)) continue;

      if (entry.isFile()) {
        out.push(rel);
      } else if (entry.isSymbolicLink() && (await this.linksToFileInside(root, join(dir, name)))) {
        out.push(rel);
      }
    }
  }

  private async linksToFileInside(root: string, link: string): Promise<boolean> {
    try {
      const real = await realpath(link);
      if (!isInside(root, real) || hasDotSegment(root, real)) return false;
      return (await stat(real)).isFile();
    } catch {
      return false;
    }
  }
}
