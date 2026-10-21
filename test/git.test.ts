import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compare, listEndpoints, type Endpoint } from '../src/git.ts';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}

export async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'agent-review-git-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  git(directory, 'init', '-q', '-b', 'main');
  git(directory, 'config', 'user.email', 'test@example.invalid');
  git(directory, 'config', 'user.name', 'Test');
  await writeFile(path.join(directory, 'example.ts'), 'const value = 1;\n');
  git(directory, 'add', '.');
  git(directory, 'commit', '-qm', 'Initial');
  return directory;
}

const main: Endpoint = { kind: 'ref', value: 'main', label: 'main' };

test('pins branch revisions and captures immutable before/after contents', async t => {
  const repository = await fixture(t);
  git(repository, 'switch', '-qc', 'feature');
  await writeFile(path.join(repository, 'example.ts'), 'const value = 2;\n');
  git(repository, 'commit', '-qam', 'Change');
  const review = await compare(repository, main, { kind: 'ref', value: 'feature', label: 'feature' });
  assert.equal(review.files.length, 1);
  assert.equal(review.files[0].before, 'const value = 1;\n');
  assert.equal(review.files[0].after, 'const value = 2;\n');
  assert.match(review.base.value, /^[0-9a-f]{40,64}$/);
  await writeFile(path.join(repository, 'example.ts'), 'later edit\n');
  assert.equal(review.files[0].after, 'const value = 2;\n');
  assert.equal(await readFile(path.join(repository, 'example.ts'), 'utf8'), 'later edit\n');
});

test('discovers local branches, remote-tracking refs, and linked worktrees', async t => {
  const repository = await fixture(t);
  git(repository, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const linked = path.join(repository, 'linked worktree');
  git(repository, 'worktree', 'add', '-qb', 'feature', linked);
  const endpoints = await listEndpoints(repository);
  assert.ok(endpoints.some(e => e.kind === 'ref' && e.value === 'refs/heads/main'));
  assert.ok(endpoints.some(e => e.kind === 'ref' && e.value === 'refs/remotes/origin/main'));
  assert.ok(endpoints.some(e => e.kind === 'worktree' && e.value === linked));
});

test('compares dirty linked worktrees with untracked files, deletions, and ignored files', async t => {
  const repository = await fixture(t);
  const linked = path.join(repository, 'linked');
  git(repository, 'worktree', 'add', '-qb', 'feature', linked);
  await rm(path.join(linked, 'example.ts'));
  await writeFile(path.join(linked, 'new file.ts'), 'export const added = true;\n');
  await writeFile(path.join(linked, '.gitignore'), 'ignored.log\n');
  await writeFile(path.join(linked, 'ignored.log'), 'ignored');
  const review = await compare(repository, main, { kind: 'worktree', value: linked, label: 'linked' });
  assert.equal(review.files.find(f => f.path === 'example.ts')?.status, 'deleted');
  assert.equal(review.files.find(f => f.path === 'new file.ts')?.after, 'export const added = true;\n');
  assert.ok(!review.files.some(f => f.path === 'ignored.log'));
  await writeFile(path.join(linked, 'new file.ts'), 'later\n');
  assert.equal(review.files.find(f => f.path === 'new file.ts')?.after, 'export const added = true;\n');
});

test('merge-base mode shows feature changes without unrelated base-branch changes', async t => {
  const repository = await fixture(t);
  git(repository, 'switch', '-qc', 'feature');
  await writeFile(path.join(repository, 'example.ts'), 'feature\n');
  git(repository, 'commit', '-qam', 'Feature');
  git(repository, 'switch', '-q', 'main');
  await writeFile(path.join(repository, 'main-only.ts'), 'main change\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-qm', 'Main moved');
  const review = await compare(repository, main, { kind: 'ref', value: 'feature', label: 'feature' }, 'merge-base');
  assert.deepEqual(review.files.map(f => f.path), ['example.ts']);
});

test('an uninitialized submodule is not reported as a deleted file', async t => {
  const repository = await fixture(t);
  const pointer = git(repository, 'rev-parse', 'HEAD');
  git(repository, 'update-index', '--add', '--cacheinfo', `160000,${pointer},library`);
  git(repository, 'commit', '-qm', 'Add submodule pointer');
  const review = await compare(repository, { kind: 'ref', value: 'HEAD', label: 'HEAD' }, { kind: 'worktree', value: repository, label: 'Working tree' });
  assert.deepEqual(review.files, []);
});

test('compares the actual dirty contents of two worktrees', async t => {
  const repository = await fixture(t);
  const linked = path.join(repository, 'linked');
  git(repository, 'worktree', 'add', '-qb', 'feature', linked);
  await writeFile(path.join(repository, 'example.ts'), 'left side\n');
  await writeFile(path.join(linked, 'example.ts'), 'right side\n');
  const review = await compare(repository, { kind: 'worktree', value: repository, label: 'Left' }, { kind: 'worktree', value: linked, label: 'Right' });
  assert.equal(review.files.length, 1);
  assert.equal(review.files[0].before, 'left side\n');
  assert.equal(review.files[0].after, 'right side\n');
});
