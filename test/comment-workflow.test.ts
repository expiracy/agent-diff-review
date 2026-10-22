import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commentStatus, groupComments } from '../src/comment-workflow.ts';
import type { Note } from '../src/review.ts';

function note(overrides: Partial<Note> = {}): Note {
  return { id: 'note', reviewId: 'current', filePath: 'file.ts', side: 'after', startLine: 2, endLine: 2,
    body: 'Handle empty input.', createdAt: '2026-10-21T07:00:00Z', resolved: false, replies: [], ...overrides };
}

test('keeps replies from earlier snapshots ready to review alongside current drafts', () => {
  const earlier = note({ id: 'earlier', reviewId: 'earlier', batchId: 'batch', replies: [{ body: 'Fixed.', createdAt: '2026-10-21T07:01:00Z' }] });
  const draft = note();
  assert.deepEqual(groupComments([draft, earlier]), [
    { status: 'review', notes: [earlier] }, { status: 'draft', notes: [draft] }
  ]);
});

test('keeps sent comments waiting until an agent reply arrives', () => {
  assert.equal(commentStatus(note({ batchId: 'batch' })), 'waiting');
});

test('puts comments marked as needing changes ahead of agent replies', () => {
  assert.equal(commentStatus(note({ needsChanges: true, batchId: 'batch', replies: [{ body: 'Fixed.', createdAt: '' }] })), 'needsChanges');
});

test('a resolved comment leaves the follow-up queue until it is reopened', () => {
  const resolved = note({ needsChanges: true, resolved: true });
  assert.equal(commentStatus(resolved), 'resolved');
  assert.equal(commentStatus({ ...resolved, resolved: false }), 'needsChanges');
});
