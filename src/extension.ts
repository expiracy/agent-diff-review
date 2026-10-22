import * as vscode from 'vscode';
import path from 'node:path';
import { Bridge, defaultRegistry } from './bridge.ts';
import { compare, listEndpoints, repositoryInfo, runGit, type Comparison, type Endpoint } from './git.ts';
import { ReviewStore, type Note, type Connection } from './review.ts';
import { comparisonOptions, sendOptions, type CompareOptions } from './command-options.ts';
import { buildFileTree, type FileTreeNode } from './file-tree.ts';
import { CommentsView } from './comments-view.ts';
import { ComparisonView } from './comparison-view.ts';
import { comparisonSources, endpointLabel, matchesComparison, swapComparison } from './comparison-selection.ts';
import { COMMENT_STATES, commentStatus } from './comment-workflow.ts';

const SCHEME = 'agent-review';
const CONTROLLER = 'agent-diff-review';
type TreeEntry = vscode.TreeItem & { kind?: 'history' | 'folder' | 'file'; reviewId?: string; filePath?: string; children?: TreeEntry[] };
type ReviewComment = vscode.Comment & { noteId?: string };
const FILE_DECORATIONS = {
  added: { badge: 'A', label: 'Added', color: 'gitDecoration.addedResourceForeground' },
  deleted: { badge: 'D', label: 'Deleted', color: 'gitDecoration.deletedResourceForeground' },
  modified: { badge: 'M', label: 'Modified', color: 'gitDecoration.modifiedResourceForeground' }
};

export class ReviewExtension implements vscode.TreeDataProvider<TreeEntry>, vscode.TextDocumentContentProvider, vscode.FileDecorationProvider {
  readonly changed = new vscode.EventEmitter<TreeEntry | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly decorationsChanged = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.decorationsChanged.event;
  readonly controller = vscode.comments.createCommentController(CONTROLLER, 'Agent Diff Review');
  readonly threads = new Map<string, vscode.CommentThread>();
  readonly output = vscode.window.createOutputChannel('Agent Diff Review');
  readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  readonly tree: vscode.TreeView<TreeEntry>;
  readonly comments = new CommentsView();
  readonly comparison: ComparisonView;
  store?: ReviewStore;
  bridge?: Bridge;
  repository?: { root: string; commonDir: string };
  private selectedConnection?: string;
  private initializing?: Promise<void>;
  private sending = false;
  private comparing = false;
  private selection?: CompareOptions;
  private selectedReviewId?: string;

  constructor(readonly context: vscode.ExtensionContext) {
    this.selectedConnection = context.workspaceState.get<string>('selectedConnection');
    this.controller.options = { prompt: 'Leave feedback for the linked agent', placeHolder: 'What should change, or what would you like explained?' };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: document => {
        const entry = this.lookup(document.uri);
        return entry && !entry.file.omitted ? [new vscode.Range(0, 0, document.lineCount - 1, 0)] : [];
      }
    };
    this.status.command = 'agentDiffReview.showComments';
    this.status.name = 'Agent Diff Review';
    this.tree = vscode.window.createTreeView('agentDiffReview', { treeDataProvider: this, showCollapseAll: true });
    this.comparison = new ComparisonView(context.extensionUri, message => this.handleComparisonAction(message));
    context.subscriptions.push(this.changed, this.decorationsChanged, this.controller, this.output, this.status, this.tree, this.comments, this.comparison,
      vscode.window.registerWebviewViewProvider('agentDiffReview.comparison', this.comparison),
      vscode.window.registerFileDecorationProvider(this),
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this));
    const register = (id: string, callback: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(`agentDiffReview.${id}`, async (...args) => {
      try { return await callback(...args); }
      catch (error) {
        this.output.appendLine(error instanceof Error ? error.stack ?? error.message : String(error));
        void vscode.window.showErrorMessage(`Agent Diff Review: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }));
    register('compare', (argument: unknown) => this.startComparison(comparisonOptions(argument)));
    register('refresh', () => this.refresh());
    register('fetch', async () => {
      await this.ensureRepository();
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Fetching remote branches…' }, () => runGit(this.repository!.root, ['fetch', '--all', '--prune']));
      void vscode.window.showInformationMessage('Remote branches fetched. Start or refresh a comparison to review the updated revisions.');
    });
    register('connect', () => this.connectInstructions());
    register('selectAgent', () => this.selectAgent());
    register('send', (argument: unknown) => this.send(sendOptions(argument)));
    register('openDiff', (entry: TreeEntry) => this.openDiff(entry.reviewId!, entry.filePath!));
    register('showReview', async (entry: TreeEntry) => {
      await this.store!.selectReview(entry.reviewId!);
    });
    register('postComment', (reply: vscode.CommentReply) => this.postComment(reply));
    register('deleteComment', (comment: ReviewComment) => this.store!.deleteNote(comment.noteId!));
    register('resolveThread', (thread: vscode.CommentThread) => this.resolveThread(thread));
    register('addComment', () => this.commentAtSelection());
    register('openComment', argument => this.openComment(this.noteFromArgument(argument).id));
    register('showComments', () => vscode.commands.executeCommand('agentDiffReview.comments.focus'));
    register('findComment', () => this.findComment());
    register('resolveComment', argument => this.store!.resolveNotes([this.noteFromArgument(argument).id], true));
    register('reopenComment', argument => this.store!.resolveNotes([this.noteFromArgument(argument).id], false));
    register('markNeedsChanges', argument => this.store!.markNeedsChanges(this.noteFromArgument(argument).id, true));
    register('clearNeedsChanges', argument => this.store!.markNeedsChanges(this.noteFromArgument(argument).id, false));
    register('reviewLatestComment', argument => this.reviewLatestComment(this.noteFromArgument(argument).id));
    register('sendCommentReview', argument => this.send(undefined, this.noteFromArgument(argument).reviewId));
  }

  async initialize(): Promise<void> {
    if (this.initializing) return this.initializing;
    this.initializing = this.initializeRepository();
    try { await this.initializing; } finally { this.initializing = undefined; }
  }

  private async initializeRepository(): Promise<void> {
    if (this.store) return;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      try { this.repository = await repositoryInfo(folder.uri.fsPath); break; }
      catch { /* The next workspace folder may contain a Git repository. */ }
    }
    if (!this.repository) return;
    const storage = this.context.storageUri;
    if (!storage) throw new Error('Open a folder workspace to store review comments.');
    const store = new ReviewStore(path.join(storage.fsPath, 'reviews.json'));
    await store.load();
    const bridge = new Bridge(store, this.repository.root, this.repository.commonDir, defaultRegistry());
    await bridge.start();
    this.store = store;
    this.bridge = bridge;
    if (!this.currentReview) {
      const branch = (await runGit(this.repository.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => Buffer.from(''))).toString().trim();
      this.selection = {
        base: { kind: 'ref', value: branch ? `refs/heads/${branch}` : 'HEAD', label: branch || 'HEAD' },
        target: { kind: 'worktree', value: this.repository.root, label: 'Working tree' }, mode: 'exact'
      };
    }
    const update = () => { this.syncThreads(); this.changed.fire(undefined); this.decorationsChanged.fire(undefined); this.comments.update(store.state); this.updateStatus(); };
    store.events.on('change', update);
    this.context.subscriptions.push({ dispose: () => { store.events.off('change', update); } });
    update();
    this.output.appendLine(`Bridge ready for ${this.repository.root}`);
  }

  private async ensureRepository(): Promise<void> {
    await this.initialize();
    if (!this.store || !this.repository) throw new Error('Open a Git repository in a trusted folder workspace first.');
  }

  get currentReview(): Comparison | undefined {
    return this.store?.state.reviews.find(review => review.id === this.store!.state.currentReviewId);
  }

  uri(reviewId: string, filePath: string, side: Note['side']): vscode.Uri {
    return vscode.Uri.from({ scheme: SCHEME, authority: reviewId, path: `/${side}/${filePath}` });
  }

  private lookup(uri: vscode.Uri) {
    if (uri.scheme !== SCHEME) return undefined;
    const review = this.store?.state.reviews.find(review => review.id === uri.authority);
    const side = uri.path.split('/')[1];
    if (!review || (side !== 'before' && side !== 'after')) return undefined;
    const file = review.files.find(file => file.path === uri.path.slice(side.length + 2));
    return file ? { review, file, side: side as Note['side'] } : undefined;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const entry = this.lookup(uri);
    if (!entry) throw new Error('This review snapshot is unavailable.');
    return entry.file.omitted ? `${entry.file.omitted}\n${entry.file.path}\n` : entry.file[entry.side];
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const entry = this.lookup(uri);
    if (!entry) return;
    const decoration = FILE_DECORATIONS[entry.file.status];
    return new vscode.FileDecoration(decoration.badge, decoration.label, new vscode.ThemeColor(decoration.color));
  }

  private async pickEndpoint(title: string, current?: Endpoint): Promise<Endpoint | undefined> {
    const endpoints = await listEndpoints(this.repository!.root);
    const choices = endpoints.map(endpoint => ({
      label: endpoint.kind === 'worktree' ? `$(folder) ${endpointLabel(endpoint)}` : `$(git-branch) ${endpoint.label}`,
      description: endpoint.kind === 'worktree' ? 'Saved working files, including untracked files' : endpoint.value.startsWith('refs/remotes/') ? 'Remote-tracking branch (last fetched)' : 'Local branch',
      detail: endpoint.value,
      endpoint
    }));
    const custom = { label: '$(edit) Enter a commit or ref…', description: 'For example HEAD, a tag, or a commit SHA', endpoint: undefined };
    const selected = await vscode.window.showQuickPick([...choices, custom], { title, placeHolder: current ? `Current: ${endpointLabel(current)}. Choose a branch or working tree.` : 'Choose a branch or working tree', matchOnDescription: true, matchOnDetail: true });
    if (!selected) return undefined;
    if (selected.endpoint) return selected.endpoint;
    const value = await vscode.window.showInputBox({ title, prompt: 'Git commit or ref', value: 'HEAD' });
    return value ? { kind: 'ref', value, label: value } : undefined;
  }

  async startComparison(options?: CompareOptions): Promise<Comparison | undefined> {
    await this.ensureRepository();
    if (!options) { await vscode.commands.executeCommand('agentDiffReview.comparison.focus'); return; }
    if (this.comparing) return;
    this.comparing = true;
    this.updateStatus();
    try {
      const review = await vscode.window.withProgress({ location: { viewId: 'agentDiffReview' }, title: 'Preparing review snapshots…' }, () => compare(this.repository!.root, options.base, options.target, options.mode));
      await this.store!.addReview(review);
      await vscode.commands.executeCommand('agentDiffReview.focus');
      return review;
    } finally { this.comparing = false; this.updateStatus(); }
  }

  async handleComparisonAction(argument: unknown): Promise<void> {
    if (!argument || typeof argument !== 'object' || this.comparing) return;
    const message = argument as { action?: unknown; side?: unknown; mode?: unknown };
    if (!['pick', 'mode', 'swap', 'compare', 'agent'].includes(String(message.action))) return;
    await this.ensureRepository();
    if (!this.selection) return;
    if (message.action === 'pick' && (message.side === 'base' || message.side === 'target')) {
      const side = message.side;
      const endpoint = await this.pickEndpoint(side === 'base' ? 'Base · left side' : 'Compare · right side', this.selection[side]);
      if (endpoint) this.selection = { ...this.selection, [side]: endpoint, mode: side === 'base' && endpoint.kind === 'worktree' ? 'exact' : this.selection.mode };
    } else if (message.action === 'mode' && (message.mode === 'exact' || message.mode === 'merge-base')) {
      if (message.mode === 'exact' || this.selection.base.kind === 'ref') this.selection = { ...this.selection, mode: message.mode };
    } else if (message.action === 'swap') this.selection = swapComparison(this.selection);
    else if (message.action === 'compare') await this.startComparison(this.selection);
    else if (message.action === 'agent') await this.selectAgent();
    this.updateStatus();
  }

  private async refresh(): Promise<void> {
    const review = this.currentReview;
    if (!review) { await this.startComparison(); return; }
    await this.startComparison(comparisonSources(review));
  }

  async openDiff(reviewId: string, filePath: string): Promise<void> {
    const review = this.store!.review(reviewId);
    const command = this.diffCommand(review, filePath, false);
    await vscode.commands.executeCommand(command.command, ...command.arguments!);
  }

  private diffCommand(review: Comparison, filePath: string, preview: boolean): vscode.Command {
    const suffix = review.mode === 'merge-base' ? ' (since common ancestor)' : '';
    const earlier = review.id !== this.currentReview?.id ? ' · Earlier snapshot' : '';
    return {
      command: 'vscode.diff', title: 'Open Diff',
      arguments: [this.uri(review.id, filePath, 'before'), this.uri(review.id, filePath, 'after'), `${path.posix.basename(filePath)} · ${endpointLabel(review.base)} → ${endpointLabel(review.target)}${suffix}${earlier}`, { preview }]
    };
  }

  private noteFromArgument(argument: unknown): Note {
    const id = typeof argument === 'string' ? argument : argument && typeof argument === 'object' && 'noteId' in argument ? argument.noteId : undefined;
    const note = this.store?.state.notes.find(note => note.id === id);
    if (!note) throw new Error('Comment not found.');
    return note;
  }

  async openComment(noteId: string): Promise<void> {
    const note = this.noteFromArgument(noteId);
    const uri = this.uri(note.reviewId, note.filePath, note.side);
    const document = await vscode.workspace.openTextDocument(uri);
    const range = new vscode.Range(note.startLine - 1, 0, note.endLine - 1, document.lineAt(note.endLine - 1).text.length);
    const thread = this.threads.get(this.threadKey(note));
    if (thread) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    await this.openDiff(note.reviewId, note.filePath);
    let finishFocus!: () => void;
    const focused = new Promise<void>(resolve => {
      const listener = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor?.document.uri.toString() === uri.toString()) finishFocus();
      });
      const timeout = setTimeout(() => finishFocus(), 1000);
      finishFocus = () => { listener.dispose(); clearTimeout(timeout); resolve(); };
    });
    try {
      await vscode.commands.executeCommand(note.side === 'before' ? 'workbench.action.compareEditor.focusSecondarySide' : 'workbench.action.compareEditor.focusPrimarySide', this.uri(note.reviewId, note.filePath, 'after'));
      if (vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) await focused;
    } finally { finishFocus(); }
    const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
    if (!editor || vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) { await vscode.window.showTextDocument(uri, { selection: range, preview: false }); return; }
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  private async findComment(): Promise<void> {
    await this.ensureRepository();
    const choices = this.store!.state.notes.slice().reverse().map(note => {
      const state = COMMENT_STATES.find(state => state.id === commentStatus(note))!;
      const review = this.store!.review(note.reviewId);
      const snapshot = note.reviewId === this.currentReview?.id ? 'Current snapshot' : `Earlier snapshot · ${new Date(review.createdAt).toLocaleString()}`;
      const detail = `${endpointLabel(review.base)} → ${endpointLabel(review.target)} · ${snapshot}${note.replies.length ? `\n${note.replies.map(reply => reply.body).join('\n\n')}` : ''}`;
      return { label: `$(${state.icon}) ${note.body.replace(/\s+/g, ' ')}`, description: `${note.filePath}:${note.startLine} · ${state.label}`, detail, noteId: note.id };
    });
    const choice = await vscode.window.showQuickPick(choices, { title: 'Find a Review Comment', placeHolder: 'Search all comments, files, and agent replies', matchOnDescription: true, matchOnDetail: true });
    if (!choice) return;
    await this.comments.reveal(choice.noteId);
    await this.openComment(choice.noteId);
  }

  async reviewLatestComment(noteId: string): Promise<void> {
    const note = this.noteFromArgument(noteId);
    const previous = this.store!.review(note.reviewId);
    const latest = await this.startComparison(comparisonSources(previous));
    if (!latest) return;
    if (latest.files.some(file => file.path === note.filePath)) await this.openDiff(latest.id, note.filePath);
    else {
      if (latest.target.kind === 'worktree') {
        const uri = vscode.Uri.file(path.join(latest.target.value, note.filePath));
        try { await vscode.workspace.fs.stat(uri); await vscode.window.showTextDocument(uri, { preview: false }); }
        catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error; }
      }
      void vscode.window.showInformationMessage(`${note.filePath} has no remaining differences in this comparison. Its original comment is still available in Comments.`);
    }
  }

  async postComment(reply: vscode.CommentReply): Promise<Note> {
    const entry = this.lookup(reply.thread.uri);
    if (!entry || !reply.thread.range) throw new Error('Select lines in an Agent Diff Review snapshot.');
    const { start, end } = reply.thread.range;
    const note = await this.store!.addNote(entry.review.id, entry.file.path, entry.side, start.line + 1, end.line + 1, reply.text);
    if (this.threads.get(this.threadKey(note)) !== reply.thread) reply.thread.dispose();
    return note;
  }

  private async commentAtSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.lookup(editor.document.uri)) throw new Error('Open a review diff and select the lines to comment on.');
    const text = await vscode.window.showInputBox({ prompt: 'Feedback for the agent', ignoreFocusOut: true });
    if (!text) return;
    const selection = editor.selection;
    const end = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line - 1 : selection.end.line;
    const thread = this.controller.createCommentThread(editor.document.uri, new vscode.Range(selection.start.line, 0, end, 0), []);
    await this.postComment({ thread, text });
  }

  private threadKey(note: Pick<Note, 'reviewId' | 'filePath' | 'side' | 'startLine' | 'endLine'>): string {
    return JSON.stringify([note.reviewId, note.filePath, note.side, note.startLine, note.endLine]);
  }

  private syncThreads(): void {
    const groups = new Map<string, Note[]>();
    for (const note of this.store!.state.notes) {
      const key = this.threadKey(note);
      groups.set(key, [...(groups.get(key) ?? []), note]);
    }
    for (const [key, thread] of this.threads) {
      if (!groups.has(key)) { thread.dispose(); this.threads.delete(key); }
    }
    for (const [key, notes] of groups) {
      const first = notes[0];
      let thread = this.threads.get(key);
      if (!thread) {
        thread = this.controller.createCommentThread(this.uri(first.reviewId, first.filePath, first.side), new vscode.Range(first.startLine - 1, 0, first.endLine - 1, 0), []);
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        this.threads.set(key, thread);
      }
      thread.comments = notes.flatMap(note => {
        const batch = this.store!.state.batches.find(batch => batch.id === note.batchId);
        const comment: ReviewComment = {
          body: note.body, mode: vscode.CommentMode.Preview, author: { name: 'You' }, noteId: note.id,
          contextValue: note.batchId ? 'sent' : 'draft', label: note.needsChanges && !note.resolved ? 'Needs changes' : !note.batchId ? 'Draft' : batch?.acknowledgedAt ? 'Received by agent' : 'Queued for agent'
        };
        return [comment, ...note.replies.map(reply => ({ body: reply.body, mode: vscode.CommentMode.Preview, author: { name: 'Agent' }, contextValue: 'agent' }))];
      });
      thread.label = `${first.filePath}:${first.startLine}${first.reviewId !== this.currentReview?.id ? ' · earlier snapshot' : ''}`;
      thread.state = notes.every(note => note.resolved) ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
      thread.contextValue = notes.every(note => note.resolved) ? 'resolved' : 'unresolved';
    }
  }

  private async resolveThread(thread: vscode.CommentThread): Promise<void> {
    const key = [...this.threads].find(([, value]) => value === thread)?.[0];
    if (!key) return;
    const ids = this.store!.state.notes.filter(note => this.threadKey(note) === key).map(note => note.id);
    await this.store!.resolveNotes(ids, thread.state !== vscode.CommentThreadState.Resolved);
  }

  private activeConnection(): Connection | undefined {
    const available = this.store?.state.connections.filter(connection => !connection.closed) ?? [];
    return available.find(connection => connection.id === this.selectedConnection) ?? (available.length === 1 ? available[0] : undefined);
  }

  private async selectAgent(): Promise<Connection | undefined> {
    await this.ensureRepository();
    const connections = this.store!.state.connections.filter(connection => !connection.closed);
    if (!connections.length) { await this.connectInstructions(); return; }
    const choice = await vscode.window.showQuickPick(connections.map(connection => ({ label: connection.label, description: connection.worktree, detail: connection.id, connection })), { title: 'Link this review to an agent session' });
    if (!choice) return;
    this.selectedConnection = choice.connection.id;
    await this.context.workspaceState.update('selectedConnection', this.selectedConnection);
    this.changed.fire(undefined);
    this.updateStatus();
    return choice.connection;
  }

  private async connectInstructions(): Promise<void> {
    await this.ensureRepository();
    const skill = vscode.Uri.joinPath(this.context.extensionUri, 'skills', 'agent-diff-review', 'SKILL.md');
    await vscode.env.clipboard.writeText(`Use the agent-diff-review skill at ${skill.fsPath} to connect this existing session to VS Code and wait for my inline review feedback. Connect with --bridge ${this.bridge!.id} from the worktree you are editing.`);
    await vscode.window.showTextDocument(skill, { preview: false });
    void vscode.window.showInformationMessage('Connection instructions copied. Paste them into the existing agent session.');
  }

  async send(options?: { connectionId: string; instruction?: string }, reviewId?: string) {
    if (this.sending) return;
    this.sending = true;
    try {
      await this.ensureRepository();
      let review = reviewId ? this.store!.review(reviewId) : this.currentReview;
      if (!options && !reviewId) {
        const drafts = this.store!.state.notes.filter(note => !note.batchId && !note.resolved);
        const reviews = this.store!.state.reviews.filter(review => drafts.some(note => note.reviewId === review.id));
        if (reviews.length === 1) review = reviews[0];
        else if (reviews.length > 1) {
          const choice = await vscode.window.showQuickPick(reviews.map(review => ({
            label: `${endpointLabel(review.base)} → ${endpointLabel(review.target)}`,
            description: `${drafts.filter(note => note.reviewId === review.id).length} drafts · ${review.id === this.currentReview?.id ? 'Current snapshot' : 'Earlier snapshot'}`,
            detail: new Date(review.createdAt).toLocaleString(), review
          })), { title: 'Send comments from which review?', matchOnDescription: true });
          if (!choice) return;
          review = choice.review;
        }
      }
      if (!review) throw new Error('Start a comparison and add comments first.');
      const connection = options ? this.store!.connection(options.connectionId) : this.activeConnection() ?? await this.selectAgent();
      if (!connection) return;
      const instruction = options ? options.instruction ?? '' : await vscode.window.showInputBox({ prompt: 'Optional overall instruction for this review', placeHolder: 'For example: fix these comments and run the relevant tests' });
      if (instruction === undefined) return;
      const batch = await this.store!.submit(review.id, connection.id, instruction);
      void vscode.window.showInformationMessage(`${batch.comments.length} comment${batch.comments.length === 1 ? '' : 's'} queued for ${connection.label}.`);
      return batch;
    } finally { this.sending = false; }
  }

  getTreeItem(entry: TreeEntry): vscode.TreeItem { return entry; }

  getChildren(parent?: TreeEntry): TreeEntry[] {
    const current = this.currentReview;
    if (parent?.kind === 'history') return this.store!.state.reviews.filter(review => review.id !== current?.id).reverse().map(review => ({
      id: `review:${review.id}`,
      label: `${review.base.label} → ${review.target.label}`, description: new Date(review.createdAt).toLocaleTimeString(),
      command: { command: 'agentDiffReview.showReview', title: 'Open Review', arguments: [{ reviewId: review.id }] }, iconPath: new vscode.ThemeIcon('history')
    }));
    if (parent?.kind === 'folder') return parent.children ?? [];
    if (parent || !current) return [];
    const files = this.fileTreeEntries(current, buildFileTree(current.files));
    const history: TreeEntry[] = this.store!.state.reviews.length > 1 ? [{ id: 'history', label: 'Previous reviews', kind: 'history', iconPath: new vscode.ThemeIcon('history'), collapsibleState: vscode.TreeItemCollapsibleState.Collapsed }] : [];
    return [...files, ...history];
  }

  private fileTreeEntries(review: Comparison, nodes: FileTreeNode[]): TreeEntry[] {
    return nodes.map(node => {
      const entry: TreeEntry = {
        id: `${node.kind}:${node.path}`, label: node.name, kind: node.kind,
        reviewId: review.id, filePath: node.path,
        resourceUri: this.uri(review.id, node.path, node.kind === 'file' && node.file.status === 'deleted' ? 'before' : 'after')
      };
      if (node.kind === 'folder') {
        entry.iconPath = vscode.ThemeIcon.Folder;
        entry.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        entry.tooltip = node.path;
        entry.children = this.fileTreeEntries(review, node.children);
      } else {
        const file = node.file;
        const notes = this.store!.state.notes.filter(note => note.reviewId === review.id && note.filePath === file.path && !note.resolved);
        const comments = notes.length ? `${notes.length} comment${notes.length === 1 ? '' : 's'}` : undefined;
        entry.iconPath = vscode.ThemeIcon.File;
        entry.description = [comments, file.omitted ? 'Preview unavailable' : undefined].filter(Boolean).join(' · ');
        entry.tooltip = `${file.path}\n${FILE_DECORATIONS[file.status].label}${comments ? ` · ${comments}` : ''}\n${file.omitted ?? `Mode: ${file.beforeMode ?? 'absent'} → ${file.afterMode ?? 'absent'}`}\nSnapshot: ${review.createdAt}\nBase: ${review.base.value}\nTarget: ${review.target.value}`;
        entry.accessibilityInformation = { label: `${file.path}, ${file.status}${comments ? `, ${comments}` : ''}${file.omitted ? ', preview unavailable' : ''}` };
        entry.command = this.diffCommand(review, file.path, true);
      }
      return entry;
    });
  }

  private updateStatus(): void {
    const review = this.currentReview;
    const connection = this.activeConnection();
    if (review && review.id !== this.selectedReviewId) {
      this.selectedReviewId = review.id;
      this.selection = comparisonSources(review);
    }
    const drafts = this.store!.state.notes.filter(note => !note.batchId && !note.resolved).length;
    const open = this.store!.state.notes.filter(note => !note.resolved).length;
    this.comparison.update({
      selection: this.selection, repository: this.repository?.root, agent: connection?.label,
      showing: review ? { base: endpointLabel(review.base), target: endpointLabel(review.target), files: review.files.length, createdAt: review.createdAt } : undefined,
      dirty: !!review && !!this.selection && !matchesComparison(this.selection, review), busy: this.comparing
    });
    void vscode.commands.executeCommand('setContext', 'agentDiffReview.hasReview', !!review);
    void vscode.commands.executeCommand('setContext', 'agentDiffReview.hasDrafts', drafts > 0);
    this.tree.description = review ? `${review.files.length} file${review.files.length === 1 ? '' : 's'}` : undefined;
    this.tree.badge = review?.files.length ? { value: review.files.length, tooltip: this.tree.description! } : undefined;
    this.tree.message = review ? `${review.files.length ? '' : 'No changed files.\n'}${endpointLabel(review.base)} → ${endpointLabel(review.target)}\n${review.mode === 'exact' ? 'Exact comparison' : 'Branch changes'} · ${connection ? `Agent: ${connection.label}` : 'No agent selected'}` : undefined;
    if (!review) { this.status.hide(); return; }
    this.status.text = `$(comment-discussion) Review${drafts ? `: ${drafts} draft${drafts === 1 ? '' : 's'}` : open ? `: ${open} open` : ''}`;
    this.status.tooltip = `${review.base.label} → ${review.target.label}\n${connection ? `Agent: ${connection.label}` : 'No agent selected'}`;
    this.status.show();
  }

  async dispose(): Promise<void> { await this.bridge?.dispose(); }
}

let active: ReviewExtension | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<ReviewExtension> {
  active = new ReviewExtension(context);
  try { await active.initialize(); }
  catch (error) { active.output.appendLine(`Bridge startup failed: ${String(error)}`); }
  return active;
}

export async function deactivate(): Promise<void> { await active?.dispose(); }
