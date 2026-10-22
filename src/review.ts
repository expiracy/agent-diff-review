import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Comparison } from './git.ts';
import { runGit } from './git.ts';

export interface Note {
  id: string;
  reviewId: string;
  filePath: string;
  side: 'before' | 'after';
  startLine: number;
  endLine: number;
  body: string;
  createdAt: string;
  batchId?: string;
  resolved: boolean;
  needsChanges?: boolean;
  replies: { body: string; createdAt: string }[];
}

export interface Connection {
  id: string;
  label: string;
  worktree: string;
  commonDir: string;
  closed: boolean;
}

export interface Batch {
  id: string;
  connectionId: string;
  reviewId: string;
  instruction: string;
  createdAt: string;
  acknowledgedAt?: string;
  comments: Note[];
}

export interface ReviewState {
  version: 1;
  currentReviewId?: string;
  reviews: Comparison[];
  notes: Note[];
  connections: Connection[];
  batches: Batch[];
}

export class ReviewStore {
  private currentState: ReviewState = { version: 1, reviews: [], notes: [], connections: [], batches: [] };
  readonly events = new EventEmitter();
  private operations: Promise<unknown> = Promise.resolve();
  constructor(readonly filename: string) {}

  get state(): ReviewState { return this.currentState; }

  async load(): Promise<void> {
    try {
      const state = JSON.parse(await readFile(this.filename, 'utf8')) as ReviewState;
      if (state.version !== 1 || !Array.isArray(state.reviews) || !Array.isArray(state.notes) || !Array.isArray(state.connections) || !Array.isArray(state.batches)) throw new Error('Unsupported review storage format.');
      this.currentState = state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private change<T>(update: (draft: ReviewState) => T | Promise<T>): Promise<T> {
    const operation = this.operations.catch(() => {}).then(async () => {
      const draft = structuredClone(this.currentState);
      const result = await update(draft);
      await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(draft), { mode: 0o600 });
        await rename(temporary, this.filename);
      } finally { await rm(temporary, { force: true }); }
      this.currentState = draft;
      this.events.emit('change');
      return result;
    });
    this.operations = operation;
    return operation;
  }

  review(id: string): Comparison {
    const review = this.state.reviews.find(review => review.id === id);
    if (!review) throw new Error('Review not found.');
    return review;
  }

  async addReview(review: Comparison): Promise<void> {
    await this.change(draft => { draft.reviews.push(review); draft.currentReviewId = review.id; });
  }

  async addNote(reviewId: string, filePath: string, side: Note['side'], startLine: number, endLine: number, body: string): Promise<Note> {
    return this.change(draft => {
      const file = this.review(reviewId).files.find(file => file.path === filePath);
      if (!file || file.omitted) throw new Error('This file has no commentable text snapshot.');
      const lines = file[side]?.replace(/\r\n/g, '\n').split('\n').length;
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines) throw new Error('Comment line range is outside the reviewed file.');
      if (!body.trim() || body.length > 16_000) throw new Error('Comments must contain 1–16000 characters.');
      const note: Note = { id: randomUUID(), reviewId, filePath, side, startLine, endLine, body: body.trim(), createdAt: new Date().toISOString(), resolved: false, replies: [] };
      draft.notes.push(note);
      return note;
    });
  }

  async connect(worktree: string, commonDir: string, label: string): Promise<Connection> {
    return this.change(draft => {
      const connection: Connection = { id: randomUUID(), worktree, commonDir, label, closed: false };
      draft.connections.push(connection);
      return connection;
    });
  }

  connection(id: string): Connection {
    const connection = this.state.connections.find(connection => connection.id === id && !connection.closed);
    if (!connection) throw new Error('Connection not found or closed. Reconnect from the agent session.');
    return connection;
  }

  async submit(reviewId: string, connectionId: string, instruction = ''): Promise<Batch> {
    return this.change(async draft => {
      const review = this.review(reviewId);
      const connection = this.connection(connectionId);
      if (review.commonDir !== connection.commonDir) throw new Error('Agent belongs to a different repository.');
      if (review.target.kind === 'worktree') {
        if (review.target.value !== connection.worktree) throw new Error('Agent must be attached to the target worktree.');
      } else {
        const head = (await runGit(connection.worktree, ['rev-parse', 'HEAD'])).toString().trim();
        if (head !== review.target.value) throw new Error('Agent worktree must be checked out at the reviewed target commit.');
      }
      const comments = draft.notes.filter(note => note.reviewId === reviewId && !note.batchId && !note.resolved);
      if (!comments.length) throw new Error('There are no draft comments to send.');
      const batch: Batch = { id: randomUUID(), connectionId, reviewId, instruction, createdAt: new Date().toISOString(), comments: structuredClone(comments) };
      if (Buffer.byteLength(JSON.stringify(this.payload(batch))) > 4 * 1024 * 1024) throw new Error('Feedback exceeds 4 MiB. Send fewer commented files in this review.');
      for (const note of comments) note.batchId = batch.id;
      draft.batches.push(batch);
      return batch;
    });
  }

  next(connectionId: string): Batch | undefined {
    this.connection(connectionId);
    return this.state.batches.find(batch => batch.connectionId === connectionId && !batch.acknowledgedAt);
  }

  payload(batch: Batch) {
    const { files, ...review } = this.review(batch.reviewId);
    const paths = new Set(batch.comments.map(note => note.filePath));
    return {
      type: 'feedback', schemaVersion: 1, batchId: batch.id, connectionId: batch.connectionId,
      instruction: batch.instruction, review, comments: batch.comments,
      files: files.filter(file => paths.has(file.path))
    };
  }

  async acknowledge(connectionId: string, batchId: string): Promise<void> {
    await this.change(draft => {
      this.connection(connectionId);
      const batch = draft.batches.find(batch => batch.id === batchId && batch.connectionId === connectionId);
      if (!batch) throw new Error('Batch does not belong to this connection.');
      batch.acknowledgedAt ??= new Date().toISOString();
    });
  }

  async reply(connectionId: string, commentId: string, body: string): Promise<void> {
    await this.change(draft => {
      this.connection(connectionId);
      const note = draft.notes.find(note => note.id === commentId);
      const batch = draft.batches.find(batch => batch.id === note?.batchId && batch.connectionId === connectionId);
      if (!note || !batch) throw new Error('Comment does not belong to this connection.');
      if (!body.trim() || body.length > 16_000) throw new Error('Reply must contain 1–16000 characters.');
      note.replies.push({ body: body.trim(), createdAt: new Date().toISOString() });
    });
  }

  async deleteNote(id: string): Promise<void> {
    await this.change(draft => {
      const note = draft.notes.find(note => note.id === id);
      if (!note || note.batchId) throw new Error('Only draft comments can be deleted. Resolve a sent comment instead.');
      draft.notes = draft.notes.filter(note => note.id !== id);
    });
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.change(draft => {
      this.connection(connectionId);
      draft.connections.find(connection => connection.id === connectionId)!.closed = true;
    });
  }

  async selectReview(reviewId: string): Promise<void> {
    await this.change(draft => { this.review(reviewId); draft.currentReviewId = reviewId; });
  }

  async resolveNotes(ids: string[], resolved: boolean): Promise<void> {
    await this.change(draft => { for (const note of draft.notes) if (ids.includes(note.id)) note.resolved = resolved; });
  }

  async markNeedsChanges(id: string, needsChanges: boolean): Promise<void> {
    await this.change(draft => {
      const note = draft.notes.find(note => note.id === id);
      if (!note) throw new Error('Comment not found.');
      note.needsChanges = needsChanges;
      if (needsChanges) note.resolved = false;
    });
  }
}
