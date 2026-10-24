import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentReviewFile } from '../src/review-navigation.ts';
import type { FileSnapshot } from '../src/git.ts';

const file = (path: string): FileSnapshot => ({ path, status: 'modified', before: 'before\n', after: 'after\n', beforeHash: '', afterHash: '', binary: false });

test('next-file navigation follows the natural folder-first Changes tree order', () => {
  const files = ['README.md', 'src/Z.ts', 'src/item10.ts', 'src/components/button.ts', 'src/item2.ts'].map(file);
  const original = structuredClone(files);
  assert.deepEqual(adjacentReviewFile(files, 'src/item2.ts', 1), { path: 'src/item10.ts', position: 3, total: 5 });
  assert.deepEqual(files, original, 'Navigation does not alter the captured files');
});

test('navigation wraps at both ends of the captured file order', () => {
  const files = ['README.md', 'src/item2.ts'].map(file);
  assert.deepEqual(adjacentReviewFile(files, 'README.md', 1), { path: 'src/item2.ts', position: 1, total: 2 });
  assert.deepEqual(adjacentReviewFile(files, 'src/item2.ts', -1), { path: 'README.md', position: 2, total: 2 });
});

test('a one-file comparison has no adjacent review file', () => {
  assert.equal(adjacentReviewFile([file('a.ts')], 'a.ts', 1), undefined);
});

test('an empty comparison has no adjacent review file', () => {
  assert.equal(adjacentReviewFile([], 'missing.ts', 1), undefined);
});

test('an unknown current path does not open an unrelated file', () => {
  assert.equal(adjacentReviewFile([file('a.ts'), file('b.ts')], 'missing.ts', 1), undefined);
});
