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
  assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputWebview && tab.label.startsWith('Change graph')), 'The graph opens as a dedicated editor page');
  const removedSymbol = graph.symbols.find(symbol => symbol.name === 'removed')!;
  await api.graph.openSymbol(graphReview.id, removedSymbol.id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(graphReview.id, 'graph.ts', 'before').toString(), 'Removed graph members open the before snapshot');
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2, 'Graph navigation selects the exact member line');
  const usage = graph.edges.find(edge => edge.kind === 'calls')!;
  await api.store!.selectReview(review.id);
  await api.graph.openUsage(graphReview.id, usage.id);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(graphReview.id, 'graph.ts', 'after').toString(), 'Graph usage links keep their saved snapshot even when another review is current');
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 1, 'A usage opens the exact call site');
  assert.equal(api.currentReview!.id, review.id, 'Graph navigation does not replace the active comparison');
  await assert.rejects(api.graph.openSymbol(graphReview.id, 'unknown-symbol'), /unavailable/);
  const restoredReview: Comparison = { ...graphReview, id: randomUUID() };
  await api.store!.addReview(restoredReview);
  await api.store!.selectReview(review.id);
  const restoredPanel = vscode.window.createWebviewPanel('agentDiffReview.graph', 'Restoring graph', vscode.ViewColumn.Active, {});
  try {
    await api.restoreGraph(restoredPanel, { reviewId: restoredReview.id });
    assert.match(restoredPanel.webview.html, /Change graph/, 'Restoration recreates the graph page in the supplied native panel');
    assert.match(restoredPanel.webview.html, /graph-layout\.js/, 'Native graph pages include the shared axes bundle');
    assert.ok(restoredPanel.webview.html.indexOf('graph-layout.js') < restoredPanel.webview.html.indexOf('graph.js'), 'Axes load before the graph renderer');
    assert.ok(restoredPanel.webview.options.localResourceRoots?.some(uri => uri.fsPath === vscode.Uri.joinPath(extension.extensionUri, 'out').fsPath), 'The native webview permits its packaged layout bundle');
    await api.graph.openSymbol(restoredReview.id, removedSymbol.id);
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), api.uri(restoredReview.id, 'graph.ts', 'before').toString(), 'A restored graph navigates to its original saved review');
    assert.equal(api.currentReview!.id, review.id, 'Restoring an older graph leaves the active comparison unchanged');
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
  await vscode.commands.executeCommand('agentDiffReview.comparison.focus');
  console.log('VS Code integration assertions passed.');
  const pause = Number(process.env.AGENT_DIFF_REVIEW_TEST_PAUSE ?? 0);
  if (pause > 0) await new Promise(resolve => setTimeout(resolve, Math.min(pause, 120_000)));
}
