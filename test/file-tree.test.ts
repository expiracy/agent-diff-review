import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFileTree } from '../src/file-tree.ts';
import type { FileSnapshot } from '../src/git.ts';

function snapshot(filePath: string, status: FileSnapshot['status'] = 'modified'): FileSnapshot {
  return { path: filePath, status, before: '', after: '', beforeHash: '', afterHash: '', binary: false };
}

test('groups changed files into nested folders while retaining the snapshot paths', () => {
  const button = snapshot('src/components/button.ts');
  const index = snapshot('src/index.ts');
  const readme = snapshot('README.md');
  assert.deepEqual(buildFileTree([button, index, readme]), [
    { kind: 'folder', name: 'src', path: 'src', children: [
      { kind: 'folder', name: 'components', path: 'src/components', children: [
        { kind: 'file', name: 'button.ts', path: button.path, file: button }
      ] },
      { kind: 'file', name: 'index.ts', path: index.path, file: index }
    ] },
    { kind: 'file', name: 'README.md', path: readme.path, file: readme }
  ]);
});

test('sorts folders before files and names naturally at each level', () => {
  const tree = buildFileTree([
    snapshot('README.md'), snapshot('src/Z.ts'), snapshot('src/item10.ts'),
    snapshot('src/a.ts'), snapshot('src/components/button.ts'), snapshot('src/item2.ts')
  ]);
  assert.deepEqual(tree.map(node => node.name), ['src', 'README.md']);
  const source = tree[0];
  assert.equal(source.kind, 'folder');
  if (source.kind === 'folder') assert.deepEqual(source.children.map(node => node.name), ['components', 'a.ts', 'item2.ts', 'item10.ts', 'Z.ts']);
});

test('retains both sides when a file replaces a directory', () => {
  const added = snapshot('feature', 'added');
  const deleted = snapshot('feature/old.ts', 'deleted');
  const tree = buildFileTree([added, deleted]);
  assert.deepEqual(tree, [
    { kind: 'folder', name: 'feature', path: 'feature', children: [
      { kind: 'file', name: 'old.ts', path: deleted.path, file: deleted }
    ] },
    { kind: 'file', name: 'feature', path: added.path, file: added }
  ]);
});
