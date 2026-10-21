#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';

const registry = process.env.AGENT_DIFF_REVIEW_REGISTRY ?? path.join(os.homedir(), '.agent-diff-review', 'bridges');
const execute = promisify(execFile);
const output = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function record(id) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid bridge ID.');
  const entry = JSON.parse(await readFile(path.join(registry, `${id}.json`), 'utf8'));
  const url = new URL(entry.url);
  if (entry.protocolVersion !== 1 || entry.bridgeId !== id || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{64}$/.test(entry.token)) {
    throw new Error('Invalid local bridge registration.');
  }
  return entry;
}

async function request(bridge, route, body, timeout = 35_000) {
  const response = await fetch(new URL(route, bridge.url), {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${bridge.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Bridge returned ${response.status}.`);
  return data;
}

async function discover(cwd) {
  const common = await execute('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  const commonDir = await realpath(path.resolve(cwd, common.stdout.trim()));
  const files = await readdir(registry).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const bridges = [];
  for (const file of files.filter(file => /^[a-f0-9]{24}\.json$/.test(file))) {
    try {
      const bridge = await record(file.slice(0, -5));
      if (bridge.commonDir !== commonDir) continue;
      const health = await request(bridge, '/health', undefined, 1500);
      if (health.bridgeId === bridge.bridgeId) bridges.push(bridge);
    } catch { /* A closed VS Code window may leave a stale registration. */ }
  }
  return bridges;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string', default: process.cwd() }, label: { type: 'string', default: 'Agent review session' },
      bridge: { type: 'string' }, connection: { type: 'string' }, timeout: { type: 'string', default: '25' },
      batch: { type: 'string' }, comment: { type: 'string' }, message: { type: 'string' }, help: { type: 'boolean' }
    }
  });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    output({
      commands: {
        discover: 'discover [--cwd <worktree>]',
        connect: 'connect [--cwd <worktree>] [--label <name>] [--bridge <id>]',
        wait: 'wait --connection <bridge/id> [--timeout <0..25 seconds>]',
        ack: 'ack --connection <bridge/id> --batch <batch-id>',
        reply: 'reply --connection <bridge/id> --comment <comment-id> --message <text>',
        disconnect: 'disconnect --connection <bridge/id>'
      },
      behavior: 'wait returns feedback as JSON to the calling agent tool. Feedback repeats until acknowledged. A pending result means call wait again; it does not wake an idle harness.'
    });
    return;
  }
  if (command === 'discover' || command === 'connect') {
    const cwd = await realpath(values.cwd);
    const bridges = await discover(cwd);
    if (command === 'discover') {
      output({ bridges: bridges.map(({ bridgeId, repository }) => ({ bridgeId, repository })) });
      return;
    }
    const candidates = values.bridge ? bridges.filter(bridge => bridge.bridgeId === values.bridge) : bridges;
    if (candidates.length !== 1) throw new Error(candidates.length
      ? `Multiple VS Code windows match. Run discover and select one with --bridge. IDs: ${candidates.map(bridge => bridge.bridgeId).join(', ')}`
      : 'No running review bridge for this repository. Open it in VS Code, enable Agent Diff Review, and run Agent Diff Review: Connect Agent.');
    const bridge = candidates[0];
    const connection = await request(bridge, '/connect', { cwd, label: values.label });
    output({ type: 'connected', ...connection, connection: `${bridge.bridgeId}/${connection.id}`, next: 'Call wait with this connection from the same agent session.' });
    return;
  }
  if (!['wait', 'ack', 'reply', 'disconnect'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const parts = values.connection?.split('/');
  if (!parts || parts.length !== 2 || !/^[a-f0-9-]{36}$/.test(parts[1])) throw new Error('--connection <bridge/id> is required.');
  const [bridgeId, id] = parts;
  const bridge = await record(bridgeId).catch(() => { throw new Error('Bridge unavailable. Reopen the same VS Code workspace, then retry wait with the saved connection.'); });
  const route = `/connections/${id}`;
  if (command === 'wait') {
    const timeout = Number(values.timeout);
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 25) throw new Error('--timeout must be between 0 and 25 seconds.');
    output({ ...await request(bridge, `${route}/wait?timeout=${timeout}`), connection: values.connection });
  } else if (command === 'ack') {
    if (!values.batch) throw new Error('--batch is required.');
    output(await request(bridge, `${route}/ack`, { batchId: values.batch }));
  } else if (command === 'reply') {
    if (!values.comment || !values.message) throw new Error('--comment and --message are required.');
    output(await request(bridge, `${route}/reply`, { commentId: values.comment, message: values.message }));
  } else {
    output(await request(bridge, `${route}/disconnect`, {}));
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ type: 'error', error: error.message }) + '\n');
  process.exitCode = 1;
});
