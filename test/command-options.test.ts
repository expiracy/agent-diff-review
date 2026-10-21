import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonOptions, sendOptions } from '../src/command-options.ts';

test('view toolbar context is not mistaken for a programmatic comparison', () => {
  assert.equal(comparisonOptions({ viewId: 'agentDiffReview' }), undefined);
});

test('view toolbar context does not override the selected agent session', () => {
  assert.equal(sendOptions({ viewId: 'agentDiffReview' }), undefined);
});
