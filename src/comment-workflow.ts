import type { Note } from './review.ts';

export const COMMENT_STATES = [
  { id: 'needsChanges', label: 'Needs changes', icon: 'warning', color: 'list.warningForeground' },
  { id: 'review', label: 'Ready to review', icon: 'comment-discussion', color: 'charts.blue' },
  { id: 'draft', label: 'Drafts', icon: 'edit', color: 'descriptionForeground' },
  { id: 'waiting', label: 'Waiting for agent', icon: 'clock', color: 'descriptionForeground' },
  { id: 'resolved', label: 'Resolved', icon: 'pass', color: 'testing.iconPassed' }
] as const;

export type CommentStatus = typeof COMMENT_STATES[number]['id'];

export function commentStatus(note: Note): CommentStatus {
  if (note.resolved) return 'resolved';
  if (note.needsChanges) return 'needsChanges';
  return note.replies.length ? 'review' : note.batchId ? 'waiting' : 'draft';
}

export function groupComments(notes: readonly Note[]): { status: CommentStatus; notes: Note[] }[] {
  return COMMENT_STATES.map(state => ({ status: state.id, notes: notes.filter(note => commentStatus(note) === state.id) })).filter(group => group.notes.length);
}
