const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { buildChangeGraph } = require(root + '/out/src/change-graph.js');
const fixture = (path, before, after) => ({ path, before, after, beforeHash: '', afterHash: '', status: before ? 'modified' : 'added', binary: false });
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

(async () => {
  const graph = await buildChangeGraph({ id: 'axes-fixture', files: [
    fixture('src/service.ts', 'class Service { run() { return target(); } }\nfunction target() { return 0; }\n', 'class Service { run() { return target() + helper(); } }\nfunction target() { return local(); }\nfunction local() { return 1; }\nfunction spare() { return target(); }\n'),
    fixture('lib/helper.ts', '', 'function helper() { return 2; }\n'),
    fixture('old/helper.ts', 'function removed() { return target(); }\n', '')
  ] });
  const directory = process.env.AXES_TEST_ARTIFACTS || await fs.mkdtemp(path.join(os.tmpdir(), 'agent-axes-tests-'));
  await fs.mkdir(directory, { recursive: true });
  let html = (await fs.readFile(root + '/src/graph-view.ts', 'utf8')).match(/return `(<\!DOCTYPE html>[\s\S]*?)`;/)[1];
  html = html.replaceAll('${webview.cspSource}', 'file:').replaceAll('${nonce}', 'test-nonce').replaceAll('${uiStyle}', 'file://' + root + '/resources/vscode-ui.css').replaceAll('${style}', 'file://' + directory + '/graph.css').replaceAll('${icons}', 'file://' + root + '/out/codicons/codicon.css').replaceAll('${layout}', 'file://' + root + '/out/graph-layout.js').replaceAll('${script}', 'file://' + root + '/resources/graph.js');
  await fs.writeFile(directory + '/index.html', html);
  const theme = ':root{--vscode-cornerRadius-small:4px;--vscode-cornerRadius-large:8px;--vscode-cornerRadius-circle:9999px;--vscode-spacing-size120:12px;--vscode-fontSize-label1:13px;--vscode-fontSize-label2:12px;--vscode-font-size:13px;--vscode-editor-background:#fff;--vscode-editorWidget-background:#fff;--vscode-foreground:#263445;--vscode-descriptionForeground:#596471;--vscode-sideBar-background:#f3f3f3;--vscode-panel-border:#cbd0d5;--vscode-editorWidget-border:#cbd0d5;--vscode-focusBorder:#285b80;--vscode-input-background:#f3f3f3;--vscode-input-foreground:#263445;--vscode-dropdown-background:#f3f3f3;--vscode-dropdown-foreground:#263445;--vscode-dropdown-border:#cbd0d5;--vscode-editorIndentGuide-background1:#8a939c;--vscode-button-background:#285b80;--vscode-button-foreground:#fff;}';
  await fs.writeFile(directory + '/graph.css', theme + await fs.readFile(root + '/resources/graph.css', 'utf8'));
  const browser = await chromium.launch({ headless: true, args: ['--force-device-scale-factor=1'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  console.log(`Axes browser runtime: Chromium ${browser.version()}`);
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(graph => {
      window.__messages = [];
      window.__state = JSON.parse(sessionStorage.getItem('graphState') || 'null');
      window.acquireVsCodeApi = () => ({ getState: () => window.__state, setState: s => { window.__state = s; sessionStorage.setItem('graphState', JSON.stringify(s)); }, postMessage: m => { window.__messages.push(m); if (m.action === 'ready') setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'graph', graph } })), 0); } });
    }, graph);
    await page.goto('file://' + directory + '/index.html');
    await page.waitForSelector('.node');

    assert.equal(await page.getByRole('button', { name: 'Layout', exact: true }).count(), 1, 'Layout is a clearly named toolbar control');
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Layout mode').selectOption('axes');
    await settle(page);
    assert.equal(await page.getByLabel('Horizontal axis').inputValue(), 'changes');
    assert.equal(await page.getByLabel('Vertical axis').inputValue(), 'status');
    assert.equal(await page.locator('#axis-guides').isVisible(), true, 'Axes have labelled guides');
    assert.match(await page.locator('#axis-guides').innerText(), /Changed lines/);
    assert.match(await page.locator('#axis-guides').innerText(), /Change type/);
    assert.match(await page.locator('#axis-guides').innerText(), /Added/);
    assert.ok(await page.locator('.node').count() >= 4, 'The full component cards remain mounted');
    const widths = await page.locator('.node').evaluateAll(nodes => nodes.map(node => node.offsetWidth));
    assert.ok(widths.every(width => width === 320), 'Axis layout retains 320px cards');
    assert.deepEqual(errors, []);
    console.log('PASS axis mode with full cards and labelled bands');
    await page.screenshot({ path: directory + '/native-axis-options.png' });
    const cameraControls = await page.locator('.camera-controls').boundingBox();
    const axisLabels = await page.locator('.axis-vertical').boundingBox();
    assert.ok(cameraControls.x >= axisLabels.x + axisLabels.width + 8, 'Camera actions sit beside the axis labels instead of covering them');
    console.log('PASS camera actions respect the axis-label gutter');


    await page.keyboard.press('Escape');
    const serviceId = graph.symbols.find(symbol => symbol.name === 'Service').id;
    await page.locator(`.node-head[data-symbol="${serviceId}"]`).click();
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Horizontal axis').selectOption('folder');
    assert.equal(await page.getByLabel('Vertical axis').locator('option[value=folder]').evaluate(option => option.disabled), true, 'The same dimension cannot be selected twice');
    await page.getByRole('button', { name: 'Swap axes', exact: true }).click();
    await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'swap-axes', 'Relayout preserves the focused control');
    assert.deepEqual(await page.evaluate(() => window.__state.axes), { horizontal: 'status', vertical: 'folder' });
    assert.deepEqual(await page.evaluate(() => window.__state.selected), { kind: 'symbol', id: serviceId });
    assert.equal(await page.evaluate(() => window.__state.reviewId), graph.reviewId, 'Changing axes retains the captured review');
    assert.deepEqual(await page.evaluate(() => window.__messages.map(message => message.action)), ['ready'], 'Relayout does not recapture or request a diff');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'layout-toggle');
    const retained = await page.evaluate(() => window.__state);
    await page.reload();
    await page.waitForSelector('.node');
    await settle(page);
    assert.deepEqual(await page.evaluate(() => window.__state.axes), retained.axes);
    assert.deepEqual(await page.evaluate(() => window.__state.camera), retained.camera);
    assert.equal(await page.locator('#context h2').innerText(), 'Service');
    assert.equal(await page.evaluate(() => window.__state.layoutMode), 'axes');
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Layout mode').selectOption('relationships');
    await settle(page);
    assert.equal(await page.locator('#axis-guides').isVisible(), false);
    assert.equal(await page.locator('#context h2').innerText(), 'Service');
    await page.getByLabel('Layout mode').selectOption('axes');
    await page.keyboard.press('Escape');
    console.log('PASS axis swapping, selection, focus, review identity and reload persistence');

    assert.equal(await page.getByLabel('Connections', { exact: true }).count(), 1, 'Connections have a clearly labelled visibility control');
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    const checkRoutes = () => page.evaluate(() => {
      const cards = [...document.querySelectorAll('.node')].map(node => ({ id: node.dataset.card, x: parseFloat(node.style.left), y: parseFloat(node.style.top), w: node.offsetWidth, h: node.offsetHeight }));
      return [...document.querySelectorAll('.graph-edge')].map(path => {
        const overlaps = [];
        for (let distance = 1; distance < path.getTotalLength(); distance += 1) {
          const p = path.getPointAtLength(distance);
          for (const card of cards) if (p.x > card.x + .5 && p.x < card.x + card.w - .5 && p.y > card.y + .5 && p.y < card.y + card.h - .5) overlaps.push(card.id);
        }
        return { id: path.dataset.edge, overlaps: [...new Set(overlaps)], arrow: path.getAttribute('marker-end') };
      });
    });
    const routes = await checkRoutes();
    assert.equal(routes.length, graph.edges.length, 'All captured cross-card connections are drawn when in view');
    assert.ok(routes.every(route => route.id && route.arrow === 'url(#graph-arrow)' && !route.overlaps.length), 'Every directed connection runs clear of all actual cards');
    const routeIds = routes.map(route => route.id).sort();
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByRole('button', { name: 'Swap axes', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    const swappedRoutes = await checkRoutes();
    assert.deepEqual(swappedRoutes.map(route => route.id).sort(), routeIds, 'Changing axes keeps connection identities');
    assert.ok(swappedRoutes.every(route => !route.overlaps.length), 'Swapped-axis routes remain clear of cards');
    console.log('PASS directed connections retain identity and stay clear of actual cards across axis changes');

    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Connections', { exact: true }).selectOption('selected');
    await page.keyboard.press('Escape');
    await settle(page);
    assert.equal(await page.locator('.graph-edge').count(), 1, 'Selected card includes its member connections and hides unrelated ones');
    assert.equal(await page.locator('.graph-edge.active').count(), 1, 'Selecting a class highlights its member connection');
    assert.match(await page.locator('#status').innerText(), /1 of 1 connections in view/);
    assert.match(await page.locator('#context').innerText(), /Uses\s+1/);
    assert.equal(await page.evaluate(() => window.__state.connectionsMode), 'selected');
    await page.reload();
    await page.waitForSelector('.graph-edge');
    assert.equal(await page.locator('.graph-edge').count(), 1, 'Connection visibility survives reload');
    const targetId = graph.symbols.find(symbol => symbol.name === 'target').id;
    await page.locator(`.node-head[data-symbol="${targetId}"]`).click();
    await settle(page);
    assert.equal(await page.locator('.graph-edge').count(), 3, 'Both incoming and outgoing connections remain visible');
    assert.equal(await page.locator('.graph-edge.active').count(), 3);
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Connections', { exact: true }).selectOption('all');
    await page.keyboard.press('Escape');
    console.log('PASS selected-card connections include class members, incoming/outgoing links and saved visibility');

    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    const pairs = await page.locator('.graph-edge').evaluateAll(paths => paths.map(path => ({ from: path.dataset.from, to: path.dataset.to })));
    const sourceRect = await page.locator(`[data-card="${serviceId}"]`).boundingBox();
    const viewRect = await page.locator('#viewport').boundingBox();
    const previousY = await page.evaluate(() => window.__state.camera.y);
    await page.mouse.move(viewRect.x + viewRect.width - 40, viewRect.y + viewRect.height - 80);
    await page.mouse.wheel(0, sourceRect.y + sourceRect.height - viewRect.y - 52 + 10);
    await page.waitForFunction(y => window.__state.camera.y !== y, previousY);
    await settle(page);
    const actualInView = await page.evaluate(pairs => {
      const view = document.getElementById('viewport').getBoundingClientRect();
      const visible = id => {
        const node = [...document.querySelectorAll('.node')].find(node => node.dataset.card === id); if (!node) return false;
        const rect = node.getBoundingClientRect(); return rect.right > view.left + 112 && rect.left < view.right && rect.bottom > view.top + 52 && rect.top < view.bottom;
      };
      return pairs.filter(pair => visible(pair.from) && visible(pair.to)).length;
    }, pairs);
    assert.ok(actualInView < pairs.length, 'The pan fixture moves some connection endpoints out of view');
    assert.equal(await page.locator('.graph-edge').count(), actualInView, 'Connections in view use the visible canvas, excluding its axis gutters');
    assert.match(await page.locator('#status').innerText(), new RegExp(`${actualInView} of ${pairs.length} connections in view`));
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    console.log('PASS off-screen connection counts track the visible canvas while panning');
    const recoveryView = await page.locator('#viewport').boundingBox();
    const recoveryBefore = await page.evaluate(() => window.__state);
    await page.mouse.move(recoveryView.x + recoveryView.width - 50, recoveryView.y + recoveryView.height - 80);
    await page.mouse.wheel(30000, 30000);
    await page.waitForFunction(y => window.__state.camera.y !== y, recoveryBefore.camera.y);
    await settle(page);
    assert.equal(await page.getByRole('button', { name: 'Show selection', exact: true }).count(), 1, 'A panned-away graph offers an explicit way back to the selection');
    assert.equal(await page.getByRole('button', { name: 'Show selection', exact: true }).isVisible(), true);
    const pannedCamera = await page.evaluate(() => window.__state.camera);
    await page.reload();
    await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
    await settle(page);
    assert.deepEqual(await page.evaluate(() => window.__state.camera), pannedCamera, 'Recovery does not silently replace a saved camera on reload');
    await page.getByRole('button', { name: 'Show selection', exact: true }).click();
    await settle(page);
    const recovered = await page.locator(`.node-head[data-symbol="${targetId}"]`).boundingBox();
    const recoveredView = await page.locator('#viewport').boundingBox();
    assert.ok(recovered.x >= recoveredView.x + 112 && recovered.y >= recoveredView.y + 52 && recovered.x + recovered.width <= recoveredView.x + recoveredView.width, 'The selected card is visible clear of the axis guides');
    assert.equal(await page.evaluate(() => window.__state.camera.zoom), recoveryBefore.camera.zoom);
    assert.deepEqual(await page.evaluate(() => window.__state.selected), recoveryBefore.selected);
    assert.equal(await page.locator('#recover-view').isVisible(), false, 'The recovery action leaves once the graph is back in view');
    console.log('PASS explicit graph recovery preserves selection and zoom across a panned-away reload');
    await page.getByRole('button', { name: 'Review overview', exact: true }).click();
    await page.mouse.move(recoveryView.x + recoveryView.width - 50, recoveryView.y + recoveryView.height - 80);
    await page.mouse.wheel(30000, 30000);
    await page.waitForFunction(() => !document.getElementById('recover-view').hidden);
    await page.setViewportSize({ width: 220, height: 480 });
    await settle(page);
    assert.equal(await page.locator('#recover-view').innerText(), 'Fit graph');
    const recoverHit = await page.locator('#recover-view').evaluate(node => { const rect = node.getBoundingClientRect(), target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return target === node || node.contains(target); });
    assert.equal(recoverHit, true, 'Recovery remains reachable in a narrow editor');
    await page.locator('#recover-view').click();
    await settle(page);
    assert.equal(await page.locator('#recover-view').isVisible(), false);
    assert.ok(await page.locator('.node').count() > 0);
    await page.setViewportSize({ width: 1500, height: 1000 });
    console.log('PASS fit recovery without a selection remains reachable at 220px');



    const beforeMembers = Array.from({ length: 65 }, (_, i) => `  method${i}() { return target() + ${i}; }`).join('\n');
    const afterMembers = beforeMembers.replaceAll('target() +', 'target() -');
    const crowded = await buildChangeGraph({ id: 'axes-expanded', files: [fixture('src/crowded.ts', `class Crowded {\n${beforeMembers}\n}\nfunction target() { return 0; }\n`, `class Crowded {\n${afterMembers}\n}\nfunction target() { return 1; }\n${Array.from({ length: 13 }, (_, i) => `function extra${i}() { return target(); }`).join('\n')}\n`)] });
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Vertical axis').selectOption('changes');
    await page.keyboard.press('Escape');
    await page.evaluate(graph => window.dispatchEvent(new MessageEvent('message', { data: { type: 'graph', graph } })), crowded);
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    const classId = crowded.symbols.find(symbol => symbol.name === 'Crowded').id;
    const countLabel = await page.locator(`.node-head[data-symbol="${classId}"] .line-counts`).getAttribute('aria-label');
    await page.getByRole('button', { name: /Show \d+ more members/ }).click();
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    const overlapping = await page.locator('.node').evaluateAll(nodes => {
      const rects = nodes.map(node => ({ id: node.dataset.card, x: parseFloat(node.style.left), y: parseFloat(node.style.top), w: node.offsetWidth, h: node.offsetHeight }));
      return rects.flatMap((a, i) => rects.slice(i + 1).filter(b => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).map(b => [a.id, b.id]));
    });
    assert.deepEqual(overlapping, [], 'Crowded cells and expanded 60-member cards do not overlap');
    assert.equal(await page.locator(`.node-head[data-symbol="${classId}"] .line-counts`).getAttribute('aria-label'), countLabel, 'Expansion does not alter the root change metric');
    assert.ok((await checkRoutes()).every(route => !route.overlaps.length), 'Connections clear the expanded card and other lanes');
    assert.equal(await page.locator('.member').count(), 74, 'A full member page and other full cards are retained');
    await page.getByRole('button', { name: /Members 1–60 of 65/ }).click();
    await settle(page);
    assert.match((await page.locator('.node-foot').allTextContents()).join(' '), /Members 61–65 of 65/);
    await page.getByRole('checkbox', { name: 'Added', exact: true }).uncheck();
    await settle(page);
    assert.equal(await page.locator(`.node-head[data-symbol="${classId}"] .line-counts`).getAttribute('aria-label'), countLabel, 'Change filters do not alter the root metric');
    await page.getByRole('checkbox', { name: 'Added', exact: true }).check();
    console.log('PASS crowded lanes, expanded cards, member paging and stable change metrics');

    await page.setViewportSize({ width: 320, height: 320 });
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    const popupRect = await page.locator('#layout-options').boundingBox();
    assert.ok(popupRect.x >= 0 && popupRect.y >= 0 && popupRect.x + popupRect.width <= 320 && popupRect.y + popupRect.height <= 320, 'The complete scrollable Layout popup fits in a small editor');
    await page.getByLabel('Connections', { exact: true }).selectOption('selected');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'layout-toggle');
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Connections', { exact: true }).selectOption('all');
    await page.keyboard.press('Escape');
    console.log('PASS Layout options stay reachable in a 320×320 editor');

    await page.setViewportSize({ width: 220, height: 480 });
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    const narrowPopup = await page.locator('#layout-options').boundingBox();
    await page.screenshot({ path: directory + '/native-narrow-options.png' });
    assert.ok(narrowPopup.x >= 0 && narrowPopup.x + narrowPopup.width <= 220, 'Layout options fit a 220px editor without horizontal clipping');
    const narrowCamera = await page.locator('.camera-controls').boundingBox();
    const narrowLabels = await page.locator('.axis-vertical').boundingBox();
    assert.ok(narrowCamera.x >= narrowLabels.x + narrowLabels.width + 8 && narrowCamera.x + narrowCamera.width <= 220, 'Camera actions stay reachable beside labels in a 220px editor');

    await page.getByLabel('Horizontal axis').selectOption('file');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1500, height: 1000 });
    console.log('PASS Layout options and file axes fit a 220px editor');

    const sixtyBefore = beforeMembers.split('\n').slice(0, 60).join('\n');
    const keyboardGraph = await buildChangeGraph({ id: 'axes-keyboard', files: [fixture('src/crowded.ts', `class Crowded {\n${sixtyBefore}\n}\nfunction target() { return 0; }\n`, `class Crowded {\n${sixtyBefore.replaceAll('target() +', 'target() -')}\n}\nfunction target() { return 1; }\n`)] });
    await page.evaluate(graph => window.dispatchEvent(new MessageEvent('message', { data: { type: 'graph', graph } })), keyboardGraph);
    await page.getByRole('button', { name: /Show \d+ more members/ }).click();
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    const headingRect = await page.locator(`.node-head[data-symbol="${classId}"]`).boundingBox();
    await page.mouse.move(headingRect.x + 20, headingRect.y + 15);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -180);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => window.__state.camera.zoom >= 1);
    await settle(page);
    await page.locator(`.node-head[data-symbol="${classId}"]`).focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+Tab');
    await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.symbol), classId);
    assert.ok(await page.evaluate(() => {
      const rect = document.activeElement.getBoundingClientRect(), view = document.getElementById('viewport').getBoundingClientRect();
      return rect.top >= view.top + 52 && rect.left >= view.left + 112 && rect.bottom <= view.bottom;
    }), 'Reverse keyboard navigation reveals the heading clear of both axis guides');
    assert.deepEqual(await page.locator('#viewport').evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop })), { x: 0, y: 0 });
    await page.keyboard.press('Enter');
    assert.ok(await page.evaluate(id => window.__messages.some(message => message.action === 'open-symbol' && message.id === id), classId));
    console.log('PASS axis guides do not cover keyboard focus and Enter still opens the saved diff');

    await page.evaluate(graph => window.dispatchEvent(new MessageEvent('message', { data: { type: 'graph', graph } })), crowded);
    await page.getByRole('button', { name: /Show \d+ more members/ }).click();
    await page.getByRole('button', { name: /Members 1–60 of 65/ }).click();
    await page.getByRole('button', { name: /Members 61–65 of 65/ }).click();
    await settle(page);
    assert.match((await page.locator('.node-foot').allTextContents()).join(' '), /Members 1–60 of 65/, 'The last partial member page wraps to the first full page');
    console.log('PASS member paging wraps without overlapping or skipping pages');

    await page.locator(`.node-head[data-symbol="${classId}"]`).click();
    await page.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await settle(page);
    await page.evaluate(() => {
      document.body.className = 'vscode-high-contrast';
      document.documentElement.style.setProperty('--vscode-foreground', '#ffffff');
      document.documentElement.style.setProperty('--vscode-editor-background', '#000000');
      document.documentElement.style.setProperty('--vscode-focusBorder', '#ffa500');
    });
    assert.equal(await page.locator('.graph-edge.active').first().evaluate(node => getComputedStyle(node).color), 'rgb(255, 165, 0)', 'Selected connections remain distinct in high contrast');
    console.log('PASS high-contrast selected connections retain the focus color');

    for (const [name, background, foreground, border] of [
      ['vscode-light', '#ffffff', '#263445', '#cbd0d5'],
      ['vscode-dark', '#1f1f1f', '#cccccc', '#555555'],
      ['vscode-high-contrast', '#000000', '#ffffff', '#6fc3df'],
      ['vscode-high-contrast-light', '#ffffff', '#000000', '#0f4a85']
    ]) {
      await page.evaluate(({name, background, foreground, border}) => {
        document.body.className = name;
        document.documentElement.style.setProperty('--vscode-button-secondaryBackground', name.includes('high-contrast') ? background : name === 'vscode-dark' ? '#3a3d41' : '#e9eef3');
        document.documentElement.style.setProperty('--vscode-button-secondaryForeground', foreground);
        document.documentElement.style.setProperty('--vscode-button-secondaryBorder', border);
        for (const token of ['editor-background', 'editorWidget-background', 'sideBar-background', 'dropdown-background']) document.documentElement.style.setProperty(`--vscode-${token}`, background);
        for (const token of ['foreground', 'descriptionForeground', 'dropdown-foreground']) document.documentElement.style.setProperty(`--vscode-${token}`, foreground);
        for (const token of ['panel-border', 'editorWidget-border', 'dropdown-border', 'contrastBorder']) document.documentElement.style.setProperty(`--vscode-${token}`, border);
      }, { name, background, foreground, border });
      assert.equal(await page.locator('.axis-band-label').first().evaluate(node => getComputedStyle(node).fontSize), '11px', 'Guide labels retain readable screen-sized typography at every zoom');
      assert.equal(await page.locator('#axis-guides .axis-horizontal').evaluate(node => getComputedStyle(node).backgroundColor), await page.locator('#viewport').evaluate(node => getComputedStyle(node).backgroundColor));
      const overlaps = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.node')].map(node => node.getBoundingClientRect());
        return [...document.querySelectorAll('.edge-label')].filter(node => {
          const rect = node.getBoundingClientRect(); return cards.some(card => rect.left < card.right && rect.right > card.left && rect.top < card.bottom && rect.bottom > card.top);
        }).length;
      });
      assert.equal(overlaps, 0, 'Connection labels do not cover card contents');
      await page.screenshot({ path: directory + `/${name}.png` });
    }
    assert.deepEqual(errors, []);
    console.log('PASS four theme classes, readable guides and labels clear of card text');

    await page.evaluate(() => sessionStorage.setItem('graphState', JSON.stringify({ ...window.__state, axes: { horizontal: 'file', vertical: 'file' }, camera: { x: 24, y: 24, zoom: 1 } })));
    await page.reload();
    await page.waitForSelector('.node');
    assert.deepEqual(await page.evaluate(() => window.__state.axes), { horizontal: 'changes', vertical: 'status' }, 'An invalid saved axis pair falls back to distinct defaults');
    assert.deepEqual(errors, []);
    console.log('PASS invalid saved axis pairs recover to usable defaults');

    const sample = graph.symbols.find(symbol => symbol.name === 'helper');
    const large = { ...graph, reviewId: 'axes-large-controlled', files: [], symbols: [], edges: [] };
    for (let i = 0; i < 5000; i++) {
      const filePath = `folder-${String(i).padStart(4, '0')}/item.ts`;
      large.files.push({ ...graph.files[1], path: filePath });
      large.symbols.push({ ...sample, id: `large-${i}`, name: `item${i}`, qualifiedName: `item${i}`, filePath });
    }
    await page.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.getByLabel('Horizontal axis').selectOption('file');
    await page.getByLabel('Vertical axis').selectOption('folder');
    await page.keyboard.press('Escape');
    const largeStarted = Date.now();
    await page.evaluate(graph => window.dispatchEvent(new MessageEvent('message', { data: { type: 'graph', graph } })), large);
    await settle(page);
    assert.ok(Date.now() - largeStarted < 3000, 'A sparse 5,000-file layout remains responsive in the browser');
    assert.ok(await page.locator('.node').count() > 0 && await page.locator('.node').count() <= 160, 'Large axes layouts keep a bounded set of full cards mounted');
    assert.ok(await page.locator('.axis-band-label').count() < 100, 'Only visible band labels are mounted');
    await page.locator('#search').fill('item4999');
    await page.waitForFunction(() => document.querySelector('.node-title')?.textContent === 'item4999');
    assert.deepEqual(errors, []);
    console.log(`PASS controlled 5,000-file overview, bounded guides and search (${Date.now() - largeStarted} ms including search)`);

    await page.screenshot({ path: directory + '/axes.png' });
    console.log(`Axes artifacts: ${directory}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
