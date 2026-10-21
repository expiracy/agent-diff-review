import { execFile } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_REVIEW_BYTES = 16 * 1024 * 1024;

export interface Endpoint {
  kind: 'ref' | 'worktree';
  value: string;
  label: string;
}

export interface FileSnapshot {
  path: string;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  status: 'added' | 'deleted' | 'modified';
  binary: boolean;
  omitted?: string;
  beforeMode?: string;
  afterMode?: string;
}

export interface Comparison {
  id: string;
  repository: string;
  commonDir: string;
  base: Endpoint;
  target: Endpoint;
  sourceBase?: Endpoint;
  sourceTarget?: Endpoint;
  mode: 'exact' | 'merge-base';
  createdAt: string;
  files: FileSnapshot[];
}

export async function runGit(cwd: string, args: string[]): Promise<Buffer> {
  const result = await execute('git', ['-C', cwd, ...args], {
    encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  });
  return result.stdout;
}

export async function repositoryInfo(cwd: string): Promise<{ root: string; commonDir: string }> {
  const root = await realpath((await runGit(cwd, ['rev-parse', '--show-toplevel'])).toString().trim());
  const commonDir = await realpath(path.resolve(root, (await runGit(root, ['rev-parse', '--git-common-dir'])).toString().trim()));
  return { root, commonDir };
}

export function contentHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function listEndpoints(repository: string): Promise<Endpoint[]> {
  const refs = (await runGit(repository, ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'])).toString();
  const endpoints: Endpoint[] = refs.split('\n').filter(Boolean).flatMap(line => {
    const [value, symbolic] = line.split('\0');
    return symbolic ? [] : [{ kind: 'ref' as const, value, label: value.replace(/^refs\/(heads|remotes)\//, '') }];
  });
  const records = (await runGit(repository, ['worktree', 'list', '--porcelain', '-z'])).toString().split('\0\0');
  for (const record of records) {
    const attributes = record.split('\0');
    const location = attributes.find(line => line.startsWith('worktree '))?.slice(9);
    if (!location || attributes.includes('bare') || attributes.some(line => line.startsWith('prunable'))) continue;
    const branch = attributes.find(line => line.startsWith('branch '))?.slice(7).replace('refs/heads/', '') ?? 'detached';
    endpoints.push({ kind: 'worktree', value: await realpath(location), label: `${branch} · ${location}` });
  }
  return endpoints;
}

interface Entry { oid: string; mode: string; size: number }

function blobHash(data: Buffer, algorithm: string): string {
  return createHash(algorithm).update(`blob ${data.length}\0`).update(data).digest('hex');
}

async function worktreeFile(root: string, name: string, algorithm: string): Promise<{ data?: Buffer; mode: string; size: number; oid: string } | undefined> {
  const location = path.join(root, name);
  const parent = await realpath(path.dirname(location)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
    throw error;
  });
  if (!parent) return undefined;
  const relative = path.relative(root, parent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path escapes the worktree: ${name}`);
  const stat = await lstat(location).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
    throw error;
  });
  if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) return undefined;
  const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644';
  if (stat.size <= MAX_FILE_BYTES || stat.isSymbolicLink()) {
    const data = stat.isSymbolicLink() ? Buffer.from(await readlink(location)) : await readFile(location);
    return { data, mode, size: data.length, oid: blobHash(data, algorithm) };
  }
  const hash = createHash(algorithm).update(`blob ${stat.size}\0`);
  for await (const chunk of createReadStream(location)) hash.update(chunk);
  return { mode, size: stat.size, oid: hash.digest('hex') };
}

async function manifest(repository: string, endpoint: Endpoint): Promise<Map<string, Entry>> {
  const result = new Map<string, Entry>();
  if (endpoint.kind === 'worktree') {
    const names = (await runGit(endpoint.value, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).toString().split('\0').filter(Boolean);
    const index = (await runGit(endpoint.value, ['ls-files', '--stage', '-z'])).toString();
    for (const record of index.split('\0')) {
      const link = /^160000 ([a-f0-9]+) 0\t([\s\S]+)$/.exec(record);
      if (!link) continue;
      let oid = link[1];
      try {
        const location = await realpath(path.join(endpoint.value, link[2]));
        const info = await repositoryInfo(location);
        if (info.root === location) oid = (await runGit(location, ['rev-parse', 'HEAD'])).toString().trim();
      } catch { /* An uninitialized submodule retains its index pointer. */ }
      result.set(link[2], { oid, mode: '160000', size: 0 });
    }
    const algorithm = (await runGit(repository, ['rev-parse', '--show-object-format'])).toString().trim();
    for (const name of new Set(names)) {
      if (result.has(name)) continue;
      const entry = await worktreeFile(endpoint.value, name, algorithm);
      if (entry) result.set(name, { oid: entry.oid, mode: entry.mode, size: entry.size });
    }
    return result;
  }
  const output = await runGit(repository, ['ls-tree', '-rlz', endpoint.value]);
  for (const record of output.toString().split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+) +([\d-]+)\t([\s\S]+)$/.exec(record);
    if (match) result.set(match[5], { mode: match[1], oid: match[3], size: Number(match[4]) || 0 });
  }
  return result;
}

async function pin(repository: string, endpoint: Endpoint): Promise<Endpoint> {
  if (endpoint.kind === 'worktree') {
    const [source, target] = await Promise.all([repositoryInfo(repository), repositoryInfo(endpoint.value)]);
    if (source.commonDir !== target.commonDir) throw new Error('Worktree belongs to a different repository.');
    return { ...endpoint, value: target.root };
  }
  return { ...endpoint, value: (await runGit(repository, ['rev-parse', '--verify', '--end-of-options', `${endpoint.value}^{commit}`])).toString().trim() };
}

async function contents(repository: string, endpoint: Endpoint, name: string, entry: Entry | undefined): Promise<Buffer> {
  if (!entry) return Buffer.alloc(0);
  if (entry.mode === '160000') return Buffer.from(`Subproject commit ${entry.oid}\n`);
  if (endpoint.kind === 'worktree') {
    const algorithm = (await runGit(repository, ['rev-parse', '--show-object-format'])).toString().trim();
    const file = await worktreeFile(endpoint.value, name, algorithm);
    if (!file?.data || file.oid !== entry.oid || file.mode !== entry.mode) throw new Error(`File changed while preparing the review: ${name}. Refresh and try again.`);
    return file.data;
  }
  return runGit(repository, ['cat-file', 'blob', entry.oid]);
}

export async function compare(repository: string, base: Endpoint, target: Endpoint, mode: Comparison['mode'] = 'exact'): Promise<Comparison> {
  const info = await repositoryInfo(repository);
  let pinnedBase = await pin(info.root, base);
  const pinnedTarget = await pin(info.root, target);
  if (mode === 'merge-base') {
    if (base.kind !== 'ref') throw new Error('Changes since common ancestor requires a branch or commit as the base.');
    const targetHead = target.kind === 'worktree'
      ? (await runGit(pinnedTarget.value, ['rev-parse', 'HEAD'])).toString().trim() : pinnedTarget.value;
    pinnedBase = { ...pinnedBase, value: (await runGit(info.root, ['merge-base', pinnedBase.value, targetHead])).toString().trim() };
  }
  const [before, after] = await Promise.all([manifest(info.root, pinnedBase), manifest(info.root, pinnedTarget)]);
  const files: FileSnapshot[] = [];
  let reviewBytes = 0;
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldEntry = before.get(name);
    const newEntry = after.get(name);
    if (oldEntry?.oid === newEntry?.oid && oldEntry?.mode === newEntry?.mode) continue;
    const tooLarge = Math.max(oldEntry?.size ?? 0, newEntry?.size ?? 0) > MAX_FILE_BYTES;
    const [oldContent, newContent] = tooLarge ? [Buffer.alloc(0), Buffer.alloc(0)] : await Promise.all([
      contents(info.root, pinnedBase, name, oldEntry), contents(info.root, pinnedTarget, name, newEntry)
    ]);
    reviewBytes += oldContent.length + newContent.length;
    if (reviewBytes > MAX_REVIEW_BYTES) throw new Error('Review exceeds 16 MiB of changed text. Compare a smaller change.');
    const binary = oldContent.includes(0) || newContent.includes(0) || !isUtf8(oldContent) || !isUtf8(newContent);
    files.push({
      path: name, before: binary ? '' : oldContent.toString(), after: binary ? '' : newContent.toString(),
      beforeHash: contentHash(oldContent), afterHash: contentHash(newContent),
      beforeMode: oldEntry?.mode, afterMode: newEntry?.mode,
      status: !oldEntry ? 'added' : !newEntry ? 'deleted' : 'modified', binary,
      omitted: tooLarge ? 'File exceeds the 512 KiB text preview limit.' : binary ? 'Binary file.' : undefined
    });
  }
  return { id: randomUUID(), repository: info.root, commonDir: info.commonDir, base: pinnedBase, target: pinnedTarget, sourceBase: base, sourceTarget: target, mode, createdAt: new Date().toISOString(), files };
}
