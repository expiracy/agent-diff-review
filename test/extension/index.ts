import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Comparison } from '../../src/git.ts';
import type { ReviewExtension } from '../../src/extension.ts';
import type { Batch, Note } from '../../src/review.ts';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('local-agent-tools.agent-diff-review');
  assert.ok(extension, 'Extension is registered');
  const api = await extension.activate() as ReviewExtension;
  const repository = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const review = await vscode.commands.executeCommand<Comparison>('agentDiffReview.compare', {
    base: { kind: 'ref', value: 'HEAD', label: 'HEAD' },
    target: { kind: 'worktree', value: repository, label: 'Working tree' }, mode: 'exact'
  });
  assert.ok(review?.files.length, 'A changed-file snapshot was created');
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
  assert.match(api.tree.message!, /HEAD → Working tree/);
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
  assert.equal(api.getChildren()[1].description, '2 comments', 'Comment counts update without replacing file identities');
  assert.equal(api.getChildren()[1].id, root[1].id);
  const execute = promisify(execFile);
  const script = path.join(extension.extensionPath, 'skills/agent-diff-review/scripts/agent-review.mjs');
  const runScript = async (...args: string[]) => {
    const result = await execute('node', [script, ...args], { env: process.env, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(result.stdout);
  };
  const connection = await runScript('connect', '--cwd', repository, '--label', 'Extension test session');
  assert.match(api.tree.message!, /Agent: Extension test session/);
  const waiting = runScript('wait', '--connection', connection.connection, '--timeout', '10');
  const batch = await vscode.commands.executeCommand<Batch>('agentDiffReview.send', { connectionId: connection.id, instruction: 'Address these comments.' });
  const feedback = await waiting;
  assert.equal(feedback.batchId, batch!.id);
  assert.deepEqual(feedback.comments.map((comment: Note) => comment.side), ['before', 'after']);
  assert.equal(feedback.instruction, 'Address these comments.');
  await runScript('ack', '--connection', connection.connection, '--batch', batch!.id);
  await runScript('reply', '--connection', connection.connection, '--comment', notes[0].id, '--message', 'Validation restored; relevant test passed.');
  assert.ok([...api.threads.values()].some(thread => thread.comments.some(comment => comment.author.name === 'Agent')), 'Agent reply appears in a native thread');
  const originalThread = [...api.threads.values()].find(thread => thread.uri.path.startsWith('/before/'))!;
  await vscode.commands.executeCommand('agentDiffReview.resolveThread', originalThread);
  assert.equal(originalThread.state, vscode.CommentThreadState.Resolved, 'Reviewer can resolve the thread');
  await vscode.commands.executeCommand('agentDiffReview.resolveThread', originalThread);
  await api.startComparison({ base: review.sourceBase!, target: review.sourceTarget!, mode: review.mode });
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
  console.log('VS Code integration assertions passed.');
  const pause = Number(process.env.AGENT_DIFF_REVIEW_TEST_PAUSE ?? 0);
  if (pause > 0) await new Promise(resolve => setTimeout(resolve, Math.min(pause, 45_000)));
}
