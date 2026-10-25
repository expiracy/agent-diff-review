import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Comparison } from '../../src/git.ts';
import type { ReviewExtension } from '../../src/extension.ts';
import type { Batch, Note } from '../../src/review.ts';
import { GraphView, type GraphLocation } from '../../src/graph-view.ts';
import type { ChangeGraph } from '../../src/change-graph.ts';
import type { GraphComments } from '../../src/graph-comments.ts';

export async function run(): Promise<void> {
  console.log(`Integration runtime: VS Code ${vscode.version}, Node ${process.versions.node}, Electron ${process.versions.electron}, Chromium ${process.versions.chrome}`);
  const extension = vscode.extensions.getExtension('local-agent-tools.agent-diff-review');
  assert.ok(extension, 'Extension is registered');
  const api = await extension.activate() as ReviewExtension;
  const repository = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const review = await vscode.commands.executeCommand<Comparison>('agentDiffReview.compare', {
    base: { kind: 'ref', value: 'HEAD', label: 'HEAD' },
    target: { kind: 'worktree', value: repository, label: 'Working tree' }, mode: 'exact'
  });
  assert.ok(review?.files.length, 'A changed-file snapshot was created');
  assert.equal(api.comparison.state.selection?.base.value, review.sourceBase!.value, 'The comparison panel shows the selected branch ref');
  await assert.rejects(api.startComparison({ base: { kind: 'ref', value: 'refs/heads/missing-review-test', label: 'Missing branch' }, target: review.sourceTarget!, mode: 'exact' }), /fatal:.*revision|unknown revision|ambiguous argument/);
  assert.equal(api.currentReview!.id, review.id, 'A failed comparison preserves the shown snapshot');
  assert.equal(api.store!.state.reviews.length, 1, 'A failed comparison does not create a partial review');
  assert.equal(api.comparison.state.busy, false, 'A failed comparison releases the busy state');
  await api.handleComparisonAction({ action: 'swap' });
  assert.equal(api.comparison.state.selection?.base.kind, 'worktree');
  assert.equal(api.comparison.state.dirty, true);
  assert.equal(api.comparison.state.showing?.base, 'HEAD', 'Unapplied selections do not relabel the shown diff');
  assert.equal(api.currentReview!.id, review.id);
  await api.handleComparisonAction({ action: 'mode', mode: 'merge-base' });
  assert.equal(api.comparison.state.selection?.mode, 'exact', 'A worktree on the left cannot use merge-base mode');
  await api.handleComparisonAction({ action: 'swap' });
  assert.equal(api.comparison.state.dirty, false);
  const root = api.getChildren();
  assert.deepEqual(root.map(entry => entry.label), ['src', 'example.ts'], 'The sidebar groups changed files into folders without action rows');
  const source = root[0];
  assert.equal(source.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  assert.equal((source.iconPath as vscode.ThemeIcon).id, vscode.ThemeIcon.Folder.id);
  const children = api.getChildren(source);
  assert.deepEqual(children.map(entry => entry.label), ['components', 'removed.ts']);
  const button = api.getChildren(children[0])[0];
  assert.equal(button.label, 'button.ts');
  assert.equal(button.filePath, 'src/components/button.ts');
  assert.equal((button.iconPath as vscode.ThemeIcon).id, vscode.ThemeIcon.File.id);
  assert.equal(button.command?.command, 'vscode.diff', 'File clicks use native diff editor behavior');
  assert.equal(api.tree.description, '3 files');
  assert.equal(api.tree.message, undefined, 'Changed files do not repeat the comparison controls above the tree');
  assert.equal(api.provideFileDecoration(button.resourceUri!)?.badge, 'A');
  assert.equal(api.provideFileDecoration(children[1].resourceUri!)?.badge, 'D');
  assert.match(children[1].resourceUri!.path, /^\/before\//, 'Deleted files retain their original snapshot');
  assert.equal(api.provideFileDecoration(root[1].resourceUri!)?.badge, 'M');
  assert.equal(api.provideFileDecoration(vscode.Uri.file(path.join(repository, 'example.ts'))), undefined, 'Review decorations do not affect workspace files');
  await vscode.commands.executeCommand(button.command!.command, ...button.command!.arguments!);
  assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.path.endsWith('/src/components/button.ts')), 'A nested file opens its own native diff');
  const nextChangedFile = await vscode.commands.executeCommand('agentDiffReview.nextFile', button.resourceUri);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(review.id, 'src/removed.ts', 'before').toString(), 'Next file follows Changes order and focuses the original side of a removed file');
  assert.deepEqual(nextChangedFile, { path: 'src/removed.ts', position: 2, total: 3 });
  assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview, true, 'Stepping through review files reuses a native preview tab rather than pinning each file');
  assert.equal(api.currentReview!.id, review.id, 'File navigation preserves the active captured comparison');
  const previousChangedFile = await vscode.commands.executeCommand('agentDiffReview.previousFile');
  assert.deepEqual(previousChangedFile, { path: 'src/components/button.ts', position: 1, total: 3 }, 'Previous file resolves the active native diff without a supplied URI');
  const previousWrapped = await vscode.commands.executeCommand('agentDiffReview.previousFile');
  assert.deepEqual(previousWrapped, { path: 'example.ts', position: 3, total: 3 });
  const nextWrapped = await vscode.commands.executeCommand('agentDiffReview.nextFile');
  assert.deepEqual(nextWrapped, { path: 'src/components/button.ts', position: 1, total: 3 });
  assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length, 1, 'Walking through a new review keeps one reusable preview diff');

  const example = review.files.find(file => file.path === 'example.ts')!;
  await vscode.commands.executeCommand('agentDiffReview.openDiff', { reviewId: review.id, filePath: 'example.ts' });
  assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputTextDiff), 'Native diff editor is open');
  const notes: Note[] = [];
  for (const side of ['before', 'after'] as const) {
    const uri = api.uri(review.id, 'example.ts', side);
    const document = await vscode.workspace.openTextDocument(uri);
    assert.equal(document.getText(), example[side]);
    const ranges = await api.controller.commentingRangeProvider!.provideCommentingRanges(document, new vscode.CancellationTokenSource().token);
    assert.ok(Array.isArray(ranges) && ranges.length, `Comment gutter is enabled on ${side}`);
    const line = side === 'before' ? 1 : 0;
    const thread = api.controller.createCommentThread(uri, new vscode.Range(line, 0, line, 0), []);
    notes.push((await vscode.commands.executeCommand<Note>('agentDiffReview.postComment', { thread, text: side === 'before' ? 'Keep the removed validation.' : 'Handle an empty input here.' }))!);
  }
  assert.equal(api.threads.size, 2, 'Native comment threads exist on both diff sides');
  assert.equal(notes[0].startLine, 2, 'Original-side line numbers are one-based');
  const draftGroup = api.comments.getChildren()[0];
  assert.equal(draftGroup?.label, 'Drafts', 'All inline comments appear together in the Comments view');
  assert.equal(api.comments.getChildren(draftGroup).length, 2);
  const activityCount = (api.tree.badge?.value ?? 0) + (api.comments.tree.badge?.value ?? 0);
  assert.equal(activityCount, notes.length, 'The activity badge counts open feedback without mixing in changed files');
  await vscode.commands.executeCommand('agentDiffReview.openComment', notes[0].id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(review.id, 'example.ts', 'before').toString(), 'A comment opens its exact diff side');
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 1, 'The original-side comment range is selected');
  await vscode.commands.executeCommand('agentDiffReview.openComment', notes[1].id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(review.id, 'example.ts', 'after').toString(), 'Modified-side comments focus the right pane');
  assert.equal(api.getChildren()[1].description, '2 comments', 'Comment counts update without replacing file identities');
  assert.equal(api.getChildren()[1].id, root[1].id);
  const execute = promisify(execFile);
  const script = path.join(extension.extensionPath, 'skills/agent-diff-review/scripts/agent-review.mjs');
  const runScript = async (...args: string[]) => {
    const result = await execute('node', [script, ...args], { env: process.env, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(result.stdout);
  };
  const connection = await runScript('connect', '--cwd', repository, '--label', 'Extension test session');
  assert.equal(api.comparison.state.agent, 'Extension test session', 'The linked agent stays visible in Comparison');
  await assert.rejects(api.send({ connectionId: 'missing-review-session', instruction: 'Attempt a send with an unavailable session.' }), /Connection not found or closed/);
  assert.equal(api.store!.state.batches.length, 0, 'A failed send does not create a delivery batch');
  assert.equal(api.store!.state.notes.filter(note => !note.batchId).length, 2, 'A failed send leaves both comments as drafts');
  const waiting = runScript('wait', '--connection', connection.connection, '--timeout', '10');
  const batch = await vscode.commands.executeCommand<Batch>('agentDiffReview.send', { connectionId: connection.id, instruction: 'Address these comments.' });
  assert.ok(batch, 'A valid send can be retried after the earlier failure');
  const feedback = await waiting;
  assert.equal(feedback.batchId, batch!.id);
  assert.deepEqual(feedback.comments.map((comment: Note) => comment.side), ['before', 'after']);
  assert.equal(feedback.instruction, 'Address these comments.');
  await runScript('ack', '--connection', connection.connection, '--batch', batch!.id);
  await runScript('reply', '--connection', connection.connection, '--comment', notes[0].id, '--message', 'Validation restored; relevant test passed.');
  assert.ok([...api.threads.values()].some(thread => thread.comments.some(comment => comment.author.name === 'Agent')), 'Agent reply appears in a native thread');
  assert.equal(api.comments.getChildren()[0].label, 'Ready to review');
  const repliedComment = api.comments.getChildren(api.comments.getChildren()[0])[0];
  assert.equal(api.comments.getChildren(repliedComment)[0]?.label, 'Validation restored; relevant test passed.', 'Agent replies can be read directly in the Comments view');
  await vscode.commands.executeCommand('agentDiffReview.markNeedsChanges', notes[0].id);
  const needsChanges = api.comments.getChildren()[0];
  assert.equal(needsChanges.label, 'Needs changes');
  const followUp = api.comments.getChildren(needsChanges)[0];
  await vscode.commands.executeCommand('agentDiffReview.resolveComment', followUp);
  assert.ok(api.comments.getChildren().some(group => group.label === 'Resolved'));
  await vscode.commands.executeCommand('agentDiffReview.reopenComment', notes[0].id);
  assert.equal(api.comments.getChildren()[0].label, 'Needs changes');
  await vscode.commands.executeCommand('agentDiffReview.clearNeedsChanges', notes[0].id);
  assert.equal(api.comments.getChildren()[0].label, 'Ready to review');
  const originalThread = [...api.threads.values()].find(thread => thread.uri.path.startsWith('/before/'))!;
  await vscode.commands.executeCommand('agentDiffReview.resolveThread', originalThread);
  assert.equal(originalThread.state, vscode.CommentThreadState.Resolved, 'Reviewer can resolve the thread');
  await vscode.commands.executeCommand('agentDiffReview.resolveThread', originalThread);
  await api.startComparison({ base: review.sourceBase!, target: review.sourceTarget!, mode: review.mode });
  const refreshedId = api.currentReview!.id;
  assert.equal(api.comments.getChildren().flatMap(group => api.comments.getChildren(group)).length, 2, 'Earlier feedback stays in the queue after refreshing');
  await vscode.commands.executeCommand('agentDiffReview.openComment', notes[0].id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.authority, review.id, 'Jumping to earlier feedback preserves its captured code');
  assert.equal(api.currentReview!.id, refreshedId, 'Opening an earlier comment does not replace the active comparison');
  assert.equal(api.getChildren()[0].id, source.id, 'Folder identities survive comparison refreshes');
  const history = api.getChildren().find(entry => entry.kind === 'history')!;
  assert.ok(history, 'Earlier snapshots remain accessible');
  const earlier = api.getChildren(history)[0];
  await vscode.commands.executeCommand(earlier.command!.command, ...earlier.command!.arguments!);
  assert.equal(api.currentReview!.id, review.id);
  await api.startComparison({ base: review.base, target: review.base, mode: 'exact' });
  assert.match(api.tree.message!, /^No changed files\./);
  assert.equal(api.tree.badge, undefined);
  assert.deepEqual(api.getChildren().map(entry => entry.kind), ['history'], 'An empty comparison does not show stale file rows');
  await api.store!.selectReview(review.id);
  await writeFile(path.join(repository, 'example.ts'), example.before);
  await vscode.commands.executeCommand('agentDiffReview.reviewLatestComment', notes[0].id);
  assert.ok(!api.currentReview!.files.some(file => file.path === 'example.ts'), 'Checking a fixed comment captures the actual saved worktree changes');
  assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'file', 'An unchanged file can be inspected as its current working file');
  assert.equal(api.store!.state.notes.find(note => note.id === notes[0].id)!.resolved, false, 'Checking the latest changes does not silently resolve feedback');
  assert.equal(api.comments.getChildren().flatMap(group => api.comments.getChildren(group)).length, 2);
  const followUpDraft = await api.store!.addNote(review.id, 'example.ts', 'before', 2, 2, 'Please also cover the boundary case.');
  const followUpBatch = await api.send({ connectionId: connection.id, instruction: 'Follow up on the earlier snapshot.' }, review.id);
  assert.equal(followUpBatch?.reviewId, review.id, 'Drafts from an earlier snapshot are sent with their own captured comparison');
  assert.equal(followUpBatch?.comments[0].id, followUpDraft.id);
  await api.store!.resolveNotes([followUpDraft.id], true);
  await writeFile(path.join(repository, 'example.ts'), example.after);
  await api.store!.selectReview(review.id);
  const graphReview: Comparison = { ...review, id: randomUUID(), files: [{ ...example, path: 'graph.ts', before: 'class Counter {\n  value() { return 1; }\n  removed() { return 0; }\n}\nfunction helper() { return 2; }\n', after: 'class Counter {\n  value() { return helper(); }\n}\nfunction helper() { return 2; }\n' }] };
  await api.store!.addReview(graphReview);
  const graph = await vscode.commands.executeCommand<import('../../src/change-graph.ts').ChangeGraph>('agentDiffReview.openGraph');
  assert.ok(graph?.symbols.some(symbol => symbol.name === 'Counter'), 'The editor graph analyses the captured comparison');
  for (let attempt = 0; attempt < 50 && !vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputWebview && tab.label.startsWith('Change graph')); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputWebview && tab.label.startsWith('Change graph')), 'The graph opens as a dedicated editor page');
  const removedSymbol = graph.symbols.find(symbol => symbol.name === 'removed')!;
  await api.graph.openSymbol(graphReview.id, removedSymbol.id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(graphReview.id, 'graph.ts', 'before').toString(), 'Removed graph members open the before snapshot');
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2, 'Graph navigation selects the exact member line');
  const singleFileLocation = vscode.window.activeTextEditor!.document.uri.toString();
  assert.equal(await vscode.commands.executeCommand('agentDiffReview.nextFile'), undefined, 'A single-file review has no unnecessary navigation operation');
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), singleFileLocation);
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2, 'A no-op leaves the current reviewed range alone');

  const usage = graph.edges.find(edge => edge.kind === 'calls')!;
  await api.store!.selectReview(review.id);
  await api.graph.openUsage(graphReview.id, usage.id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(graphReview.id, 'graph.ts', 'after').toString(), 'Graph usage links keep their saved snapshot even when another review is current');
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 1, 'A usage opens the exact call site');
  assert.equal(api.currentReview!.id, review.id, 'Graph navigation does not replace the active comparison');
  await assert.rejects(api.graph.openSymbol(graphReview.id, 'unknown-symbol'), /unavailable/);
  await api.store!.selectReview(graphReview.id);
  await api.openDiff(review.id, 'src/components/button.ts');
  const earlierFile = await vscode.commands.executeCommand('agentDiffReview.nextFile');
  assert.deepEqual(earlierFile, { path: 'src/removed.ts', position: 2, total: 3 }, 'File navigation uses the open diff snapshot even when the current comparison has different files');
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(review.id, 'src/removed.ts', 'before').toString());
  assert.equal(api.currentReview!.id, graphReview.id, 'Navigating an older review does not select it as the current comparison');
  await api.store!.selectReview(review.id);

  const restoredReview: Comparison = { ...graphReview, id: randomUUID(), base: { kind: 'ref', value: '1'.repeat(40), label: 'Earlier base' }, target: { kind: 'ref', value: review.base.value, label: 'Earlier target' }, mode: 'merge-base' };
  await api.store!.addReview(restoredReview);
  await api.store!.selectReview(review.id);
  const restoredPanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Restoring graph', vscode.ViewColumn.Active, {});
  const snapshotMessages: Array<{ type?: string; graph?: ChangeGraph; snapshot?: unknown; feedback?: GraphComments }> = [];
  const sendRestored = restoredPanel.webview.postMessage.bind(restoredPanel.webview);
  restoredPanel.webview.postMessage = message => { snapshotMessages.push(message); return sendRestored(message); };

  try {
    await api.restoreGraph(restoredPanel, { reviewId: restoredReview.id });
    assert.match(restoredPanel.webview.html, /Change graph/, 'Restoration recreates the graph page in the supplied native panel');
    assert.deepEqual(snapshotMessages.find(message => message.graph)?.snapshot, { base: restoredReview.base, target: restoredReview.target, mode: restoredReview.mode }, 'A restored graph publishes its captured revisions, not the current comparison');

    assert.match(restoredPanel.webview.html, /graph-layout\.js/, 'Native graph pages include the shared axes bundle');
    assert.ok(restoredPanel.webview.html.indexOf('graph-layout.js') < restoredPanel.webview.html.indexOf('graph.js'), 'Axes load before the graph renderer');
    assert.ok(restoredPanel.webview.options.localResourceRoots?.some(uri => uri.fsPath === vscode.Uri.joinPath(extension.extensionUri, 'out').fsPath), 'The native webview permits its packaged layout bundle');
    await api.graph.openSymbol(restoredReview.id, removedSymbol.id);
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(restoredReview.id, 'graph.ts', 'before').toString(), 'A restored graph navigates to its original saved review');
    assert.equal(api.currentReview!.id, review.id, 'Restoring an older graph leaves the active comparison unchanged');
    const graphFeedbackNote = await api.store!.addNote(restoredReview.id, 'graph.ts', 'before', 3, 3, 'Feedback from the normal diff should appear on the graph.');
    const feedbackMessage = snapshotMessages.find(message => message.type === 'comments' && message.feedback?.notes.some(note => note.id === graphFeedbackNote.id));
    assert.ok(feedbackMessage, 'Persisting a normal diff comment publishes a live update to its saved graph');
    assert.deepEqual(feedbackMessage.feedback!.symbols[removedSymbol.id], [graphFeedbackNote.id]);
    assert.equal(api.currentReview!.id, review.id, 'Comment badge updates do not select another comparison');
    const graphFeedbackBatch = await api.store!.submit(restoredReview.id, connection.id, 'Graph badge test feedback.');
    await api.store!.reply(connection.id, graphFeedbackNote.id, 'The captured member is fixed and tested.');
    const replyMessage = snapshotMessages.filter(message => message.type === 'comments').at(-1)!;
    assert.equal(replyMessage.feedback!.notes.find(note => note.id === graphFeedbackNote.id)?.replies[0].body, 'The captured member is fixed and tested.', 'Agent replies are published live to the graph');
    assert.deepEqual(replyMessage.feedback!.statuses[graphFeedbackNote.id], { id: 'review', label: 'Ready to review' });
    await api.store!.acknowledge(connection.id, graphFeedbackBatch.id);
    await api.graph.show(restoredReview);
    for (let attempt = 0; attempt < 50 && !(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    const resolvingGraphTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(resolvingGraphTab?.input instanceof vscode.TabInputWebview, 'The graph is active before resolving its comment');
    await api.graph.commentAction(restoredReview.id, graphFeedbackNote.id, 'resolve-comment');
    assert.equal(api.store!.state.notes.find(note => note.id === graphFeedbackNote.id)!.resolved, true, 'Resolving from the graph updates the shared review store');
    const graphFeedbackThread = [...api.threads.values()].find(thread => thread.uri.authority === restoredReview.id && thread.range.start.line === 2)!;
    assert.equal(graphFeedbackThread.state, vscode.CommentThreadState.Resolved, 'Resolving from the graph also resolves the normal diff thread');
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab, resolvingGraphTab, 'Resolving a graph comment keeps the same graph open');
    assert.equal(snapshotMessages.filter(message => message.type === 'comments').at(-1)?.feedback?.statuses[graphFeedbackNote.id].id, 'resolved', 'Resolved graph conversations remain visible with their shared review status');
    await api.graph.commentAction(restoredReview.id, graphFeedbackNote.id, 'reopen-comment');
    assert.equal(api.store!.state.notes.find(note => note.id === graphFeedbackNote.id)!.resolved, false, 'Reopening from the graph updates the same saved comment');
    assert.equal(graphFeedbackThread.state, vscode.CommentThreadState.Unresolved, 'The normal diff thread reopens with the graph conversation');
    assert.equal(snapshotMessages.filter(message => message.type === 'comments').at(-1)?.feedback?.statuses[graphFeedbackNote.id].id, 'review', 'Reopened agent replies return to Ready to review');
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab, resolvingGraphTab, 'Reopening keeps the graph active');
    await api.graph.commentAction(restoredReview.id, graphFeedbackNote.id, 'open-comment');
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(restoredReview.id, 'graph.ts', 'before').toString(), 'Go to Comment opens the exact original side from the graph snapshot');
    assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2, 'Go to Comment selects the comment line rather than the whole component');
    assert.equal(graphFeedbackThread.collapsibleState, vscode.CommentThreadCollapsibleState.Expanded, 'Go to Comment expands the shared native thread');
    assert.equal(api.currentReview!.id, review.id, 'Graph comment actions leave the active comparison unchanged');
    const commentsBeforeRejectedAction = structuredClone(api.store!.state.notes);
    const locationBeforeRejectedAction = vscode.window.activeTextEditor?.document.uri.toString();
    await assert.rejects(api.graph.commentAction(restoredReview.id, notes[0].id, 'resolve-comment'), /unavailable in this graph snapshot/, 'A graph cannot modify another snapshot\'s comment');
    await assert.rejects(api.graph.commentAction(restoredReview.id, 'missing-comment', 'open-comment'), /unavailable in this graph snapshot/);
    await assert.rejects(api.graph.commentAction('missing-graph', graphFeedbackNote.id, 'reopen-comment'), /unavailable in this graph snapshot/);
    assert.deepEqual(api.store!.state.notes, commentsBeforeRejectedAction, 'Rejected graph actions leave every comment unchanged');
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), locationBeforeRejectedAction, 'Rejected navigation leaves the native editor in place');
    await api.graph.commentAction(restoredReview.id, graphFeedbackNote.id, 'resolve-comment');
    const feedbackRestore = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Restoring graph comments', vscode.ViewColumn.Active, {});
    const feedbackRestoreMessages: Array<{ graph?: ChangeGraph; feedback?: GraphComments }> = [];
    const publishRestoredFeedback = feedbackRestore.webview.postMessage.bind(feedbackRestore.webview);
    feedbackRestore.webview.postMessage = message => { feedbackRestoreMessages.push(message); return publishRestoredFeedback(message); };
    try {
      await api.restoreGraph(feedbackRestore, { reviewId: restoredReview.id });
      const savedFeedback = feedbackRestoreMessages.find(message => message.graph)?.feedback!;
      assert.deepEqual(savedFeedback.symbols[removedSymbol.id], [graphFeedbackNote.id], 'Restoring a graph restores its comment badge data');
      assert.equal(savedFeedback.notes.find(note => note.id === graphFeedbackNote.id)?.replies.length, 1, 'Restored graph conversations include saved agent replies');
      assert.equal(savedFeedback.statuses[graphFeedbackNote.id].id, 'resolved');
      assert.equal(api.currentReview!.id, review.id);
    } finally { feedbackRestore.dispose(); }
  } finally { restoredPanel.dispose(); }
  const unavailablePanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Unavailable graph', vscode.ViewColumn.Active, {});
  let unavailableDisposed = false;
  const unavailableSubscription = unavailablePanel.onDidDispose(() => { unavailableDisposed = true; });
  try {
    await assert.doesNotReject(api.restoreGraph(unavailablePanel, { reviewId: 'missing-review-snapshot' }), 'An unavailable saved graph closes gracefully');
    assert.equal(unavailableDisposed, true, 'An unavailable graph does not leave an empty editor tab');
    assert.equal(api.currentReview!.id, review.id, 'An unavailable graph does not replace the current comparison');
  } finally { unavailableSubscription.dispose(); unavailablePanel.dispose(); }
  const analysisFailureReview: Comparison = { ...graphReview, id: randomUUID(), files: [{ ...graphReview.files[0], after: 42 as unknown as string }] };
  await api.store!.addReview(analysisFailureReview);
  await api.store!.selectReview(review.id);
  const analysisFailurePanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Analysis failure', vscode.ViewColumn.Active, {});
  let analysisFailureDisposed = false;
  const analysisFailureSubscription = analysisFailurePanel.onDidDispose(() => { analysisFailureDisposed = true; });
  try {
    await api.restoreGraph(analysisFailurePanel, { reviewId: analysisFailureReview.id });
    assert.equal(analysisFailureDisposed, false, 'A restored graph with an analysis error stays open for Retry');
    assert.equal(api.currentReview!.id, review.id, 'Analysis failure does not replace the current comparison');
  } finally { analysisFailureSubscription.dispose(); analysisFailurePanel.dispose(); }
  let attempts = 0;
  let finishRetry!: (graph: ChangeGraph) => void;
  const retryLocations: GraphLocation[] = [];
  const retryView = new GraphView(extension.extensionUri, async location => { retryLocations.push(location); }, {
    build: async snapshot => {
      assert.equal(snapshot.id, graphReview.id, 'Retry uses the original captured review');
      assert.deepEqual(snapshot.files, graphReview.files);
      if (++attempts === 1) throw new Error('Temporary analysis failure');
      return new Promise<ChangeGraph>(resolve => { finishRetry = resolve; });
    },
    dispose() {}
  });
  const retryPanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Retry test', vscode.ViewColumn.Active, {});
  try {
    await assert.rejects(retryView.show(graphReview, retryPanel), /Temporary analysis failure/);
    const graphTabCount = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview).length;
    const retried = retryView.retry(graphReview.id);
    const duplicate = retryView.retry(graphReview.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2, 'Concurrent retry requests start just one additional analysis');
    finishRetry(graph);
    assert.equal(await retried, graph);
    assert.equal(await duplicate, graph);
    assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview).length, graphTabCount, 'Retry keeps the existing editor panel');
    await retryView.openSymbol(graphReview.id, removedSymbol.id);
    assert.equal(retryLocations[0]?.reviewId, graphReview.id, 'The recovered graph still navigates within its saved review');
    assert.equal(retryLocations[0]?.side, 'before');
  } finally { retryPanel.dispose(); retryView.dispose(); }
  const pendingGraphs: Array<(result: ChangeGraph) => void> = [];
  const lifecycleLocations: GraphLocation[] = [];
  const lifecycleView = new GraphView(extension.extensionUri, async location => { lifecycleLocations.push(location); }, {
    build: snapshot => {
      assert.equal(snapshot.id, graphReview.id);
      return new Promise<ChangeGraph>(resolve => { pendingGraphs.push(resolve); });
    },
    dispose() {}
  });
  const closingPanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Closing analysis', vscode.ViewColumn.Active, {});
  const closingAnalysis = lifecycleView.show(graphReview, closingPanel);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingGraphs.length, 1, 'Analysis is pending before the graph is closed');
  closingPanel.dispose();
  const replacementPanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Replacement analysis', vscode.ViewColumn.Active, {});
  let replacementDisposed = false;
  const replacementSubscription = replacementPanel.onDidDispose(() => { replacementDisposed = true; });
  try {
    const replacementAnalysis = lifecycleView.show(graphReview, replacementPanel);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingGraphs.length, 2, 'Reopening a closed pending graph creates a usable replacement page');
    pendingGraphs[1](graph);
    assert.equal(await replacementAnalysis, graph);
    pendingGraphs[0](graph);
    assert.equal(await closingAnalysis, graph, 'Late analysis of a closed panel settles without affecting its replacement');
    assert.equal(replacementDisposed, false);
    await lifecycleView.openSymbol(graphReview.id, removedSymbol.id);
    assert.equal(lifecycleLocations[0]?.reviewId, graphReview.id);
    assert.equal(lifecycleLocations[0]?.side, 'before', 'The replacement still opens the captured original-side symbol');
  } finally {
    pendingGraphs.forEach(finish => finish(graph));
    replacementSubscription.dispose(); closingPanel.dispose(); replacementPanel.dispose(); lifecycleView.dispose();
  }
  let reopenAttempts = 0;
  let finishReopen: ((result: ChangeGraph) => void) | undefined;
  let reopening: Promise<ChangeGraph> | undefined;
  const reopenLocations: GraphLocation[] = [];
  const reopenView = new GraphView(extension.extensionUri, async location => { reopenLocations.push(location); }, {
    build: async snapshot => {
      assert.equal(snapshot.id, graphReview.id);
      assert.deepEqual(snapshot.files, graphReview.files, 'Reopening retries the original captured review');
      if (++reopenAttempts === 1) throw new Error('Reopen analysis failure');
      return new Promise<ChangeGraph>(resolve => { finishReopen = resolve; });
    },
    dispose() {}
  });
  const failedPanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Reopen failed graph', vscode.ViewColumn.Active, {});
  let failedPanelDisposed = false;
  const failedPanelSubscription = failedPanel.onDidDispose(() => { failedPanelDisposed = true; });
  try {
    await assert.rejects(reopenView.show(graphReview, failedPanel), /Reopen analysis failure/);
    reopening = reopenView.show(graphReview);
    const duplicateReopen = reopenView.show(graphReview);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reopenAttempts, 2, 'Repeated Open Graph requests share one retry');
    assert.equal(reopening, duplicateReopen);
    assert.equal(failedPanelDisposed, false, 'Open Graph retries a failed review in its existing panel to retain view state');
    assert.ok(finishReopen);
    finishReopen(graph);
    assert.equal(await reopening, graph);
    assert.equal(await duplicateReopen, graph);
    await reopenView.openSymbol(graphReview.id, removedSymbol.id);
    assert.equal(reopenLocations[0]?.reviewId, graphReview.id);
    assert.equal(reopenLocations[0]?.side, 'before');
  } finally {
    finishReopen?.(graph);
    await reopening?.catch(() => undefined);
    failedPanelSubscription.dispose(); failedPanel.dispose(); reopenView.dispose();
  }

  const graphCommentText = 'Keep this graph member until callers have migrated.';
  const notesBeforeGraphComment = api.store!.state.notes.length;
  if ((await vscode.commands.getCommands()).includes('workbench.action.focusWindow')) await vscode.commands.executeCommand('workbench.action.focusWindow');
  await api.graph.openSymbol(graphReview.id, removedSymbol.id, true);
  // Native widgets render asynchronously, especially in the minimum supported host.
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(api.store!.state.notes.length, notesBeforeGraphComment, 'Nothing is saved or sent before Add Comment');
  await vscode.commands.executeCommand('type', { text: graphCommentText });
  await new Promise(resolve => setTimeout(resolve, 300));
  await vscode.commands.executeCommand('editor.action.submitComment');
  for (let attempt = 0; attempt < 50 && api.store!.state.notes.length === notesBeforeGraphComment; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  const graphNote = api.store!.state.notes.find(note => note.body === graphCommentText);
  assert.ok(graphNote, 'The graph action opens a native inline composer that saves through Add Comment');
  assert.equal(graphNote.reviewId, graphReview.id);
  assert.equal(graphNote.side, 'before', 'Removed code is commented on its captured original side');
  assert.equal(graphNote.startLine, 3);
  assert.equal(graphNote.endLine, 3);
  assert.equal(graphNote.batchId, undefined, 'Graph feedback joins the existing draft queue');
  assert.ok(api.comments.getChildren().flatMap(group => api.comments.getChildren(group)).some(entry => entry.noteId === graphNote.id), 'Graph comments appear in the same Comments view');
  assert.equal(api.currentReview!.id, review.id, 'Commenting on an older graph preserves the active comparison');

  const usageCommentText = 'Explain the new helper dependency at this call site.';
  await api.graph.openUsage(graphReview.id, usage.id, true);
  // Native widgets render asynchronously, especially in the minimum supported host.
  await new Promise(resolve => setTimeout(resolve, 1000));
  await vscode.commands.executeCommand('type', { text: usageCommentText });
  await new Promise(resolve => setTimeout(resolve, 300));
  await vscode.commands.executeCommand('editor.action.submitComment');
  for (let attempt = 0; attempt < 50 && !api.store!.state.notes.some(note => note.body === usageCommentText); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  const usageNote = api.store!.state.notes.find(note => note.body === usageCommentText);
  assert.ok(usageNote, 'A graph connection opens a native comment composer at its call site');
  assert.equal(usageNote.reviewId, graphReview.id);
  assert.equal(usageNote.side, 'after');
  assert.equal(usageNote.startLine, 2);
  assert.equal(usageNote.endLine, 2);
  assert.equal(api.currentReview!.id, review.id);

  const fileCommentText = 'Please explain the changes in this captured file.';
  await api.graph.openFile(graphReview.id, 'graph.ts', true);
  // Native widgets render asynchronously, especially in the minimum supported host.
  await new Promise(resolve => setTimeout(resolve, 1000));
  await vscode.commands.executeCommand('type', { text: fileCommentText });
  await new Promise(resolve => setTimeout(resolve, 300));
  await vscode.commands.executeCommand('editor.action.submitComment');
  for (let attempt = 0; attempt < 50 && !api.store!.state.notes.some(note => note.body === fileCommentText); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  const fileNote = api.store!.state.notes.find(note => note.body === fileCommentText);
  assert.ok(fileNote, 'Graph file Details opens the same native comment composer');
  assert.equal(fileNote.reviewId, graphReview.id);
  assert.equal(fileNote.side, 'after');
  assert.equal(fileNote.startLine, 1);
  assert.equal(fileNote.endLine, 1);

  await runScript('ack', '--connection', connection.connection, '--batch', followUpBatch!.id);
  const waitingForGraphFeedback = runScript('wait', '--connection', connection.connection, '--timeout', '10');
  const graphBatch = await api.send({ connectionId: connection.id, instruction: 'Address the graph review feedback.' }, graphReview.id);
  const graphFeedback = await waitingForGraphFeedback;
  assert.equal(graphFeedback.batchId, graphBatch!.id);
  assert.equal(graphFeedback.review.id, graphReview.id, 'Graph comments are delivered with their captured comparison, not the current review');
  assert.deepEqual(graphFeedback.comments.map((note: Note) => note.id), [graphNote.id, usageNote.id, fileNote.id]);
  assert.deepEqual(graphFeedback.files, JSON.parse(JSON.stringify(graphReview.files)), 'The agent receives the exact captured files in the JSON feedback payload');
  await runScript('ack', '--connection', connection.connection, '--batch', graphBatch!.id);
  await runScript('reply', '--connection', connection.connection, '--comment', graphNote.id, '--message', 'The removed member is retained and its callers are covered.');
  assert.ok([...api.threads.values()].some(thread => thread.uri.authority === graphReview.id && thread.comments.some(comment => comment.author.name === 'Agent')), 'Agent replies to graph comments appear in the same native threads');
  const graphReply = api.comments.getChildren().flatMap(group => api.comments.getChildren(group)).find(entry => entry.noteId === graphNote.id)!;
  assert.equal(api.comments.getChildren(graphReply)[0]?.label, 'The removed member is retained and its callers are covered.', 'Graph replies remain readable in the existing Comments view');
  assert.equal(api.currentReview!.id, review.id);

  const component = graph.symbols.find(symbol => symbol.name === 'Counter')!;
  await api.graph.show(graphReview);
  const diffTabsBeforeContext = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length;
  const componentNote = await api.commentGraphSymbol({ graphReviewId: graphReview.id, graphSymbolId: component.id }, async () => 'Review the entire Counter component.');
  assert.ok(componentNote, 'A component context comment is saved as a normal review draft');
  assert.equal(componentNote.reviewId, graphReview.id);
  assert.equal(componentNote.filePath, 'graph.ts');
  assert.equal(componentNote.side, 'after');
  assert.equal(componentNote.startLine, 1);
  assert.equal(componentNote.endLine, 3, 'A component comment covers its complete captured range');
  assert.equal(componentNote.batchId, undefined);
  assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length, diffTabsBeforeContext, 'Writing from the graph does not open another diff');
  assert.equal(api.currentReview!.id, review.id);

  const sharedMemberThread = [...api.threads.values()].find(thread => thread.uri.toString() === api.uri(graphReview.id, 'graph.ts', 'before').toString() && thread.range.start.line === 2)!;
  const memberContextNote = await api.commentGraphSymbol({ graphReviewId: graphReview.id, graphSymbolId: removedSymbol.id }, async options => {
    assert.match(options.prompt!, /graph\.ts:3 · Before snapshot/);
    return 'Comment on only the removed subfunction from the graph.';
  });
  assert.ok(memberContextNote);
  assert.equal(memberContextNote.side, 'before');
  assert.equal(memberContextNote.startLine, 3);
  assert.equal(memberContextNote.endLine, 3);
  assert.ok([...api.threads.values()].includes(sharedMemberThread), 'Graph context comments reuse the existing normal-diff thread');
  assert.ok(sharedMemberThread.comments.some(comment => comment.body === memberContextNote.body), 'The subfunction comment appears in the same native thread as inline diff feedback');
  await api.openComment(memberContextNote.id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(graphReview.id, 'graph.ts', 'before').toString());
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2, 'Opening the graph comment in the normal diff selects its exact member');

  const notesBeforeCancelledContext = api.store!.state.notes.length;
  assert.equal(await api.commentGraphSymbol({ graphReviewId: graphReview.id, graphSymbolId: component.id }, async () => undefined), undefined);
  assert.equal(api.store!.state.notes.length, notesBeforeCancelledContext, 'Cancelling graph feedback creates no draft');
  await assert.rejects(api.commentGraphSymbol({ graphReviewId: graphReview.id, graphSymbolId: 42 }, async () => { throw new Error('Invalid context must not open an input'); }), /Right-click a graph component/);
  await assert.rejects(api.commentGraphSymbol({ graphReviewId: graphReview.id, graphSymbolId: 'unknown-component' }, async () => { throw new Error('Unknown symbols must not open an input'); }), /unavailable/);
  assert.equal(api.store!.state.notes.length, notesBeforeCancelledContext);

  const contextDelivery = runScript('wait', '--connection', connection.connection, '--timeout', '10');
  const contextBatch = await api.send({ connectionId: connection.id, instruction: 'Address the component and subfunction feedback.' }, graphReview.id);
  const contextFeedback = await contextDelivery;
  assert.equal(contextFeedback.batchId, contextBatch!.id);
  assert.deepEqual(contextFeedback.comments.map((note: Note) => [note.id, note.side, note.startLine, note.endLine]), [[componentNote.id, 'after', 1, 3], [memberContextNote.id, 'before', 3, 3]], 'Right-click graph drafts use the same agent delivery payload with exact component/member ranges');
  assert.equal(contextFeedback.review.id, graphReview.id);
  await runScript('ack', '--connection', connection.connection, '--batch', contextBatch!.id);
  await api.graph.commentAction(graphReview.id, memberContextNote.id, 'resolve-comment');
  assert.equal(sharedMemberThread.state, vscode.CommentThreadState.Unresolved, 'Resolving one graph comment leaves other open comments on the same native thread unresolved');
  assert.equal(api.store!.state.notes.find(note => note.id === graphNote.id)!.resolved, false, 'An action on a shared range does not resolve a different comment');
  await api.graph.commentAction(graphReview.id, memberContextNote.id, 'reopen-comment');

  const unavailableTextReview: Comparison = { ...graphReview, id: randomUUID(), files: [{ ...example, path: 'image.bin', binary: true, omitted: 'Binary file.' }] };
  await api.store!.addReview(unavailableTextReview);
  await api.store!.selectReview(review.id);
  await api.graph.show(unavailableTextReview);
  const postedBeforeUnavailable = api.store!.state.notes.length;
  await assert.rejects(api.graph.openFile(unavailableTextReview.id, 'image.bin', true), /no commentable text snapshot/, 'The host rejects unavailable text even if a stale graph requests a comment');
  await assert.rejects(api.graph.openFile(graphReview.id, 'not-in-this-graph.ts', true), /not in the graph snapshot/);
  assert.equal(api.store!.state.notes.length, postedBeforeUnavailable, 'Rejected comment requests create no drafts');
  assert.equal(api.currentReview!.id, review.id, 'Unavailable graph comments leave the active comparison alone');

  await vscode.window.showTextDocument(vscode.Uri.file(path.join(repository, 'example.ts')), { preview: false });
  const outsideReview = vscode.window.activeTextEditor!.document.uri.toString();
  await assert.rejects(api.navigateFile(1), /Open a saved review diff/, 'Navigation outside a review gives guidance rather than opening unrelated captured content');
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), outsideReview);
  await vscode.commands.executeCommand('agentDiffReview.comparison.focus');
  console.log('VS Code integration assertions passed.');
  const pause = Number(process.env.AGENT_DIFF_REVIEW_TEST_PAUSE ?? 0);
  if (pause > 0) { await api.graph.show(graphReview); await new Promise(resolve => setTimeout(resolve, Math.min(pause, 120_000))); }
}
