import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { contentHash, type Comparison } from '../src/git.ts';
import { ReviewStore } from '../src/review.ts';

export const sampleReview = (): Comparison => ({
  id: 'review-one', repository: '/repo', commonDir: '/repo/.git',
  base: { kind: 'ref', value: 'a'.repeat(40), label: 'main' },
  target: { kind: 'worktree', value: '/repo', label: 'Working tree' },
  mode: 'exact', createdAt: new Date().toISOString(),
  files: [{ path: 'file.ts', before: 'old\nremoved\n', after: 'new\n', beforeHash: contentHash('old\nremoved\n'), afterHash: contentHash('new\n'), status: 'modified', binary: false }]
});

async function storeFixture(t: { after(fn: () => Promise<void>): void }): Promise<ReviewStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-review-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new ReviewStore(path.join(directory, 'state.json'));
}

test('saves original-side line comments with their immutable reviewed code', async t => {
  const store = await storeFixture(t);
  await store.addReview(sampleReview());
  const note = await store.addNote('review-one', 'file.ts', 'before', 2, 2, 'Keep this validation.');
  assert.ok(note.id);
  assert.equal(store.state.notes[0].startLine, 2);
  assert.equal(store.state.notes[0].side, 'before');
  assert.equal(store.state.notes[0].body, 'Keep this validation.');
});

test('persists a reviewer marking a comment as needing more changes', async t => {
  const store = await storeFixture(t);
  await store.addReview(sampleReview());
  const note = await store.addNote('review-one', 'file.ts', 'after', 1, 1, 'Handle an empty input.');
  await store.markNeedsChanges(note.id, true);
  const reloaded = new ReviewStore(store.filename);
  await reloaded.load();
  assert.equal(reloaded.state.notes[0].needsChanges, true);
  assert.equal(reloaded.state.notes[0].resolved, false);
});

test('redelivers queued feedback after restart until its intended connection acknowledges it', async t => {
  const store = await storeFixture(t);
  await store.addReview(sampleReview());
  const connection = await store.connect('/repo', '/repo/.git', 'Current agent');
  await store.addNote('review-one', 'file.ts', 'after', 1, 1, 'Handle an empty input.');
  const batch = await store.submit('review-one', connection.id);
  assert.ok(batch);
  const restarted = new ReviewStore(store.filename);
  await restarted.load();
  assert.equal(restarted.next(connection.id)?.id, batch.id);
  assert.equal(restarted.next(connection.id)?.id, batch.id);
  await restarted.acknowledge(connection.id, batch.id);
  assert.equal(restarted.next(connection.id), undefined);
});

test('rejects sending a review to an agent attached to a different worktree', async t => {
  const store = await storeFixture(t);
  await store.addReview(sampleReview());
  const connection = await store.connect('/other-worktree', '/repo/.git', 'Other agent');
  await store.addNote('review-one', 'file.ts', 'after', 1, 1, 'Fix this.');
  await assert.rejects(store.submit('review-one', connection.id), /worktree/i);
  assert.equal(store.state.notes[0].batchId, undefined);
});

test('a failed disk write does not mark draft comments as sent', async t => {
  const store = await storeFixture(t);
  await store.addReview(sampleReview());
  const connection = await store.connect('/repo', '/repo/.git', 'Current agent');
  await store.addNote('review-one', 'file.ts', 'after', 1, 1, 'Fix this.');
  await rm(store.filename);
  await mkdir(store.filename);
  await assert.rejects(store.submit('review-one', connection.id));
  assert.equal(store.state.notes[0].batchId, undefined);
  assert.equal(store.next(connection.id), undefined);
  await rm(store.filename, { recursive: true });
  assert.ok(await store.submit('review-one', connection.id));
});
