const { existsSync } = require('node:fs');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'agent-review-vscode-'));
  const repository = path.join(temporary, 'repository');
  await mkdir(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(repository, 'example.ts'), 'const before = true;\nconst removed = true;\n');
  await mkdir(path.join(repository, 'src', 'components'), { recursive: true });
  await writeFile(path.join(repository, 'src', 'removed.ts'), 'export const removed = true;\n');
  git('add', '.'); git('commit', '-qm', 'Initial');
  await writeFile(path.join(repository, 'example.ts'), 'const after = true;\n');
  await writeFile(path.join(repository, 'src', 'components', 'button.ts'), 'export const button = true;\n');
  await rm(path.join(repository, 'src', 'removed.ts'));
  const userData = path.join(temporary, 'user-data');
  await mkdir(path.join(userData, 'User'), { recursive: true });
  await writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off',
    'update.mode': 'none', 'extensions.autoUpdate': false
  }));
  const localCode = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  try {
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE ?? (existsSync(localCode) ? localCode : undefined),
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, '../out/test/extension/index.js'),
      extensionTestsEnv: { AGENT_DIFF_REVIEW_REGISTRY: path.join(temporary, 'registry'), AGENT_DIFF_REVIEW_TEST_PAUSE: process.env.AGENT_DIFF_REVIEW_TEST_PAUSE ?? '0' },
      launchArgs: [repository, '--user-data-dir', userData, '--extensions-dir', path.join(temporary, 'extensions'), '--skip-welcome', '--skip-release-notes', '--disable-extensions', '--disable-workspace-trust']
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
