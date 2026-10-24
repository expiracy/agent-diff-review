const {mkdir, copyFile, readFile, writeFile} = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const destination = path.join(root, 'out', 'src', 'parsers');
  await mkdir(destination, {recursive: true});
  const icons = path.join(root, 'out', 'codicons');
  await mkdir(icons, {recursive: true});
  for (const filename of ['codicon.css', 'codicon.ttf']) await copyFile(path.join(root, 'node_modules', '@vscode', 'codicons', 'dist', filename), path.join(icons, filename));
  await copyFile(path.join(root, 'node_modules', '@vscode', 'codicons', 'LICENSE'), path.join(icons, 'LICENSE'));
  await copyFile(path.join(root, 'node_modules', '@vscode', 'codicons', 'LICENSE-CODE'), path.join(icons, 'LICENSE-CODE'));
  await copyFile(require.resolve('web-tree-sitter/web-tree-sitter.wasm'), path.join(destination, 'web-tree-sitter.wasm'));
  const grammars = path.join(root, 'node_modules', '@repomix', 'tree-sitter-wasms', 'out');
  for (const language of ['typescript', 'tsx', 'javascript', 'python', 'cpp', 'java', 'c_sharp']) {
    await copyFile(path.join(grammars, `tree-sitter-${language}.wasm`), path.join(destination, `tree-sitter-${language}.wasm`));
  }
  const notices = await Promise.all(['web-tree-sitter/LICENSE', 'diff/LICENSE'].map(async name => `${name}\n\n${await readFile(path.join(root, 'node_modules', name), 'utf8')}`));
  await writeFile(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
  await require('esbuild').build({ entryPoints: [path.join(root, 'src', 'graph-layout.ts')], outfile: path.join(root, 'out', 'graph-layout.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'GraphLayout', target: 'chrome124' });
  await require('esbuild').build({ entryPoints: [path.join(root, 'src', 'graph-worker.ts')], outfile: path.join(root, 'out', 'src', 'graph-worker.js'), bundle: true, platform: 'node', format: 'cjs', target: 'node20', alias: { 'web-tree-sitter': require.resolve('web-tree-sitter') }, legalComments: 'eof' });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
