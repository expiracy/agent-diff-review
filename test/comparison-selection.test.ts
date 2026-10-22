import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonSources, matchesComparison, swapComparison } from '../src/comparison-selection.ts';
import type { Comparison } from '../src/git.ts';

const review: Comparison = {
  id: 'snapshot', repository: '/repo', commonDir: '/repo/.git', mode: 'merge-base', createdAt: '', files: [],
  base: { kind: 'ref', value: 'a'.repeat(40), label: 'main' },
  target: { kind: 'ref', value: 'b'.repeat(40), label: 'feature' },
  sourceBase: { kind: 'ref', value: 'refs/heads/main', label: 'main' },
  sourceTarget: { kind: 'ref', value: 'refs/heads/feature', label: 'feature' }
};

test('comparison selectors retain branch refs instead of pinned snapshot commits', () => {
  assert.deepEqual(comparisonSources(review), { base: review.sourceBase, target: review.sourceTarget, mode: 'merge-base' });
});

test('recognizes the shown comparison independently of display labels', () => {
  const selection = comparisonSources(review);
  assert.equal(matchesComparison({ ...selection, base: { ...selection.base, label: 'Renamed display label' } }, review), true);
  assert.equal(matchesComparison({ ...selection, target: selection.base }, review), false);
  assert.equal(matchesComparison({ ...selection, mode: 'exact' }, review), false);
});

test('swapping a worktree onto the left selects exact comparison mode', () => {
  const selection = { ...comparisonSources(review), target: { kind: 'worktree' as const, value: '/repo', label: 'Feature worktree' } };
  assert.deepEqual(swapComparison(selection), { base: selection.target, target: selection.base, mode: 'exact' });
});
