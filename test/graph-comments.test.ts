import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graphComments } from '../src/graph-comments.ts';
import type { ChangeGraph, GraphSymbol } from '../src/change-graph.ts';
import type { Note } from '../src/review.ts';

const symbol = (id: string, start: number, end: number, parentId?: string): GraphSymbol => ({
  id, name: id, qualifiedName: id, kind: parentId ? 'method' : 'class', filePath: 'counter.ts', parentId,
  status: 'modified', signature: id, detail: 'Body changed', changes: { added: 1, removed: 1 },
  before: { startLine: start, endLine: end }, after: { startLine: start, endLine: end }
});
const graph: ChangeGraph = { reviewId: 'saved', symbols: [symbol('Counter', 1, 12), symbol('value', 3, 5, 'Counter'), symbol('reset', 7, 10, 'Counter')], edges: [], files: [{ path: 'counter.ts', status: 'modified', changes: { added: 1, removed: 1 }, otherChanges: { added: 0, removed: 0 } }] };
const note = (id: string, startLine: number, endLine = startLine): Note => ({ id, reviewId: 'saved', filePath: 'counter.ts', side: 'after', startLine, endLine, body: `Comment ${id}`, createdAt: '2026-10-25T00:00:00Z', resolved: false, replies: [] });

test('maps an inline comment to its member and rolls it up to the component once', () => {
  const feedback = note('inline', 4);
  const result = graphComments(graph, [feedback]);
  assert.deepEqual(result.symbols, { value: ['inline'], Counter: ['inline'] });
  assert.deepEqual(result.files, { 'counter.ts': ['inline'] });
  assert.deepEqual(result.notes, [feedback]);
});

test('a whole-component comment does not become a separate comment on every member', () => {
  assert.deepEqual(graphComments(graph, [note('component', 1, 12)]).symbols, { Counter: ['component'] });
});

test('matches original-side locations against original ranges rather than shifted modified lines', () => {
  const shifted = structuredClone(graph);
  shifted.symbols[1].after = { startLine: 7, endLine: 9 };
  shifted.symbols[2].after = { startLine: 11, endLine: 12 };
  const original = { ...note('original', 8), side: 'before' as const };
  assert.deepEqual(graphComments(shifted, [original]).symbols, { reset: ['original'], Counter: ['original'] });
});

test('shares a native line comment between symbols on the same captured line without double-counting the component', () => {
  const sameLine = { ...graph, symbols: [symbol('Counter', 1, 1), symbol('value', 1, 1, 'Counter'), symbol('reset', 1, 1, 'Counter')] };
  assert.deepEqual(graphComments(sameLine, [note('line', 1)]).symbols, { Counter: ['line'], value: ['line'], reset: ['line'] });
});

test('keeps replies and resolved feedback, isolates snapshots, and retains file-only comments', () => {
  const replied = { ...note('replied', 4), resolved: true, replies: [{ body: 'Fixed and tested.', createdAt: '2026-10-25T00:01:00Z' }] };
  const outside = note('file-only', 20);
  const result = graphComments(graph, [replied, outside, { ...note('other-review', 4), reviewId: 'another-snapshot' }]);
  assert.deepEqual(result.notes, [replied, outside]);
  assert.deepEqual(result.symbols, { value: ['replied'], Counter: ['replied'] });
  assert.deepEqual(result.files, { 'counter.ts': ['replied', 'file-only'] });
});

test('uses the same review status labels as the shared Comments queue', () => {
  const replied = { ...note('replied', 4), batchId: 'sent', replies: [{ body: 'Updated.', createdAt: '2026-10-25T00:01:00Z' }] };
  assert.deepEqual(graphComments(graph, [replied]).statuses?.replied, { id: 'review', label: 'Ready to review' });
});
