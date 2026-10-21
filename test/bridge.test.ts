import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Bridge } from '../src/bridge.ts';
import { compare } from '../src/git.ts';
import { ReviewStore } from '../src/review.ts';

async function bridgeFixture(t: { after(fn: () => Promise<void>): void }) {
  const repository = await realpath(await mkdtemp(path.join(os.tmpdir(), 'agent-review-bridge-')));
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(repository, 'file.ts'), 'before\n');
  git('add', '.'); git('commit', '-qm', 'Initial');
  await writeFile(path.join(repository, 'file.ts'), 'after\n');
  const store = new ReviewStore(path.join(repository, '.git', 'review-state.json'));
  const review = await compare(repository, { kind: 'ref', value: 'HEAD', label: 'HEAD' }, { kind: 'worktree', value: repository, label: 'Working tree' });
  await store.addReview(review);
  const registry = path.join(repository, '.git', 'registry');
  const bridge = new Bridge(store, repository, review.commonDir, registry);
  await bridge.start();
  t.after(async () => { await bridge.dispose(); await rm(repository, { recursive: true, force: true }); });
  return { bridge, store, review, repository, registry };
}

test('bridge requires a bearer token and rejects browser-origin calls', async t => {
  const { bridge } = await bridgeFixture(t);
  const unauthorized = await fetch(`${bridge.url}/health`);
  assert.equal(unauthorized.status, 401);
  const authorized = await fetch(`${bridge.url}/health`, { headers: { authorization: `Bearer ${bridge.token}` } });
  assert.equal(authorized.status, 200);
  const browser = await fetch(`${bridge.url}/health`, { headers: { authorization: `Bearer ${bridge.token}`, origin: 'https://example.invalid' } });
  assert.equal(browser.status, 403);
});

test('delivers a review batch to the linked agent waiting on the bridge', async t => {
  const { bridge, store, review, repository } = await bridgeFixture(t);
  const headers = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' };
  const response = await fetch(`${bridge.url}/connect`, { method: 'POST', headers, body: JSON.stringify({ cwd: repository, label: 'Existing agent session' }) });
  assert.equal(response.status, 200);
  const connection = await response.json() as { id: string };
  const waiting = fetch(`${bridge.url}/connections/${connection.id}/wait?timeout=2`, { headers });
  await store.addNote(review.id, 'file.ts', 'after', 1, 1, 'Validate this input.');
  const batch = await store.submit(review.id, connection.id);
  const payload = await (await waiting).json() as { type: string; batchId: string; comments: { body: string }[]; files: { before: string; after: string }[] };
  assert.equal(payload.type, 'feedback');
  assert.equal(payload.batchId, batch.id);
  assert.equal(payload.comments[0].body, 'Validate this input.');
  assert.equal(payload.files[0].before, 'before\n');
  assert.equal(payload.files[0].after, 'after\n');
  const ack = await fetch(`${bridge.url}/connections/${connection.id}/ack`, { method: 'POST', headers, body: JSON.stringify({ batchId: batch.id }) });
  assert.equal(ack.status, 200);
  assert.equal(store.next(connection.id), undefined);
});

test('the standalone script connects and returns comments to its calling process', async t => {
  const { store, review, repository, registry } = await bridgeFixture(t);
  const execute = promisify(execFile);
  const script = path.resolve(__dirname, '../../skills/agent-diff-review/scripts/agent-review.mjs');
  const run = async (...args: string[]) => {
    const result = await execute(process.execPath, [script, ...args], { env: { ...process.env, AGENT_DIFF_REVIEW_REGISTRY: registry } });
    return JSON.parse(result.stdout);
  };
  const connected = await run('connect', '--cwd', repository, '--label', 'My existing session');
  assert.match(connected.connection ?? '', /^[a-f0-9]{24}\/[a-f0-9-]+$/);
  const waiting = run('wait', '--connection', connected.connection, '--timeout', '2');
  const comment = await store.addNote(review.id, 'file.ts', 'before', 1, 1, 'Keep the original check.');
  const batch = await store.submit(review.id, connected.id);
  const feedback = await waiting;
  assert.equal(feedback.comments[0].id, comment.id);
  assert.equal(feedback.files[0].before, 'before\n');
  await run('ack', '--connection', connected.connection, '--batch', batch.id);
  assert.equal((await run('wait', '--connection', connected.connection, '--timeout', '0')).type, 'pending');
});

test('feedback cannot cross repository or connection boundaries', async t => {
  const { bridge, store, review, repository } = await bridgeFixture(t);
  const headers = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' };
  const first = await store.connect(repository, review.commonDir, 'First session');
  const second = await store.connect(repository, review.commonDir, 'Second session');
  const note = await store.addNote(review.id, 'file.ts', 'after', 1, 1, 'Only for the first session.');
  const batch = await store.submit(review.id, first.id);
  const otherWait = await fetch(`${bridge.url}/connections/${second.id}/wait?timeout=0`, { headers });
  assert.equal((await otherWait.json() as { type: string }).type, 'pending');
  const otherAck = await fetch(`${bridge.url}/connections/${second.id}/ack`, { method: 'POST', headers, body: JSON.stringify({ batchId: batch.id }) });
  assert.equal(otherAck.status, 400);
  const otherReply = await fetch(`${bridge.url}/connections/${second.id}/reply`, { method: 'POST', headers, body: JSON.stringify({ commentId: note.id, message: 'Wrong session' }) });
  assert.equal(otherReply.status, 400);
  const unrelated = await mkdtemp(path.join(os.tmpdir(), 'unrelated-review-repo-'));
  t.after(() => rm(unrelated, { recursive: true, force: true }));
  execFileSync('git', ['-C', unrelated, 'init', '-q']);
  const otherRepo = await fetch(`${bridge.url}/connect`, { method: 'POST', headers, body: JSON.stringify({ cwd: unrelated, label: 'Wrong repository' }) });
  assert.equal(otherRepo.status, 400);
});
