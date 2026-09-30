import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findAllProjectContextFiles, invalidateContextFileCache } from '../system.ts';

describe('findAllProjectContextFiles depth cap', () => {
  const dirs: string[] = [];

  afterEach(() => {
    invalidateContextFileCache();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tree(files: string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'craft-context-depth-'));
    dirs.push(root);
    for (const file of files) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), '# context\n');
    }
    return root;
  }

  const cases: Array<[string, string, boolean]> = [
    ['root file', 'CLAUDE.md', true],
    ['repo-level file', 'repo/AGENTS.md', true],
    ['four directories deep', 'a/b/c/d/CLAUDE.md', true],
    ['five directories deep is not walked', 'a/b/c/d/e/CLAUDE.md', false],
  ];

  for (const [name, file, found] of cases) {
    it(name, () => {
      const root = tree([file]);
      expect(findAllProjectContextFiles(root)).toEqual(found ? [file] : []);
    });
  }
});
