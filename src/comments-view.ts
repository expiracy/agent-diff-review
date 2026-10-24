import * as vscode from 'vscode';
import type { Note, ReviewState } from './review.ts';
import { COMMENT_STATES, commentStatus, groupComments, type CommentStatus } from './comment-workflow.ts';

export type CommentEntry = vscode.TreeItem & { status: CommentStatus; noteId?: string; replyIndex?: number };

export class CommentsView implements vscode.TreeDataProvider<CommentEntry>, vscode.Disposable {
  readonly changed = new vscode.EventEmitter<CommentEntry | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly tree = vscode.window.createTreeView('agentDiffReview.comments', { treeDataProvider: this, showCollapseAll: true });
  private state?: ReviewState;

  update(state: ReviewState): void {
    this.state = state;
    const open = state.notes.filter(note => !note.resolved).length;
    this.tree.description = state.notes.length ? `${open} open` : undefined;
    this.tree.badge = open ? { value: open, tooltip: `${open} open review comments` } : undefined;
    this.changed.fire(undefined);
  }

  getTreeItem(entry: CommentEntry): vscode.TreeItem { return entry; }

  getChildren(parent?: CommentEntry): CommentEntry[] {
    if (!this.state || parent?.replyIndex !== undefined) return [];
    if (parent?.noteId) {
      const note = this.state.notes.find(note => note.id === parent.noteId);
      return note?.replies.map((reply, index) => ({
        id: `comment:${note.id}:reply:${index}`, noteId: note.id, replyIndex: index, status: commentStatus(note),
        label: reply.body.replace(/\s+/g, ' '), description: 'Agent reply', tooltip: new vscode.MarkdownString().appendText(reply.body),
        iconPath: new vscode.ThemeIcon('comment'), contextValue: 'agentReply',
        command: { command: 'agentDiffReview.openComment', title: 'Go to Comment', arguments: [note.id] }
      })) ?? [];
    }
    const groups = groupComments(this.state.notes);
    if (parent) return (groups.find(group => group.status === parent.status)?.notes ?? [])
      .slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(note => this.noteEntry(note));
    return groups.map(group => {
      const state = COMMENT_STATES.find(state => state.id === group.status)!;
      return {
        id: `comment-group:${state.id}`, status: state.id, label: state.label, description: String(group.notes.length),
        contextValue: 'commentGroup', iconPath: new vscode.ThemeIcon(state.icon, new vscode.ThemeColor(state.color)),
        collapsibleState: state.id === 'resolved' || state.id === 'waiting' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
      };
    });
  }

  getParent(entry: CommentEntry): CommentEntry | undefined {
    const note = this.state?.notes.find(note => note.id === entry.noteId);
    if (note && entry.replyIndex !== undefined) return this.noteEntry(note);
    return note ? this.getChildren().find(group => group.status === commentStatus(note)) : undefined;
  }

  async reveal(noteId: string): Promise<void> {
    const note = this.state?.notes.find(note => note.id === noteId);
    if (!note) return;
    await this.tree.reveal(this.noteEntry(note), { select: true, focus: false });
  }

  private noteEntry(note: Note): CommentEntry {
    const state = COMMENT_STATES.find(state => state.id === commentStatus(note))!;
    const review = this.state!.reviews.find(review => review.id === note.reviewId)!;
    const location = `${note.filePath}:${note.startLine}${note.endLine === note.startLine ? '' : `–${note.endLine}`}`;
    const earlier = note.reviewId !== this.state!.currentReviewId;
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(note.body);
    const reply = note.replies.at(-1);
    if (reply) tooltip.appendMarkdown('\n\n---\n\n').appendText(`Agent: ${reply.body}`);
    if (state.id === 'needsChanges') tooltip.appendMarkdown('\n\n').appendText('Add a follow-up comment in the diff, then Send Review to ask the agent for more changes.');
    tooltip.appendMarkdown('\n\n---\n\n').appendText(`${state.label}\n${location} · ${note.side === 'before' ? 'Left / original' : 'Right / modified'}\n${review.base.label} → ${review.target.label}\nSnapshot: ${review.createdAt}${earlier ? ' (earlier review)' : ''}`);
    return {
      id: `comment:${note.id}`, status: state.id, noteId: note.id,
      label: note.body.replace(/\s+/g, ' '), description: `${location} · ${note.side === 'before' ? 'Left' : 'Right'}${earlier ? ' · Earlier snapshot' : ''}`,
      tooltip, iconPath: new vscode.ThemeIcon(state.icon, new vscode.ThemeColor(state.color)),
      collapsibleState: note.replies.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      contextValue: note.resolved ? 'resolvedReviewComment' : note.needsChanges ? 'needsChangesReviewComment' : !note.batchId ? 'draftReviewComment' : 'openReviewComment',
      accessibilityInformation: { label: `${state.label}, ${note.body}, ${location}, ${note.side}${earlier ? ', earlier snapshot' : ''}` },
      command: { command: 'agentDiffReview.openComment', title: 'Go to Comment', arguments: [note.id] }
    };
  }

  dispose(): void { this.tree.dispose(); this.changed.dispose(); }
}
