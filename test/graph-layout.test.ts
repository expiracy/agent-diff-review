import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutAxes, routeAxesConnections, type AxisCard, type AxesLayout, type LayoutPoint } from '../src/graph-layout.ts';

const card = (id: string, filePath: string): AxisCard => ({ id, filePath, label: id, status: 'modified', changes: { added: 1, removed: 1 }, height: 140 });

test('the largest finite change band includes 200 before the open-ended band', () => {
  const items = [200, 201].map(total => ({ ...card(String(total), 'a.ts'), changes: { added: total, removed: 0 } }));
  const layout = layoutAxes(items, { horizontal: 'changes', vertical: 'folder' });
  assert.deepEqual(layout.columns.map(band => band.label), ['51–200', '201+']);
});
test('swapping axes preserves connection identity and leaves snapshot metrics unchanged', () => {
  const items = [{ ...card('a', 'src/a.ts'), changes: { added: 20, removed: 5 } }, { ...card('b', 'test/b.ts'), status: 'added' }];
  const original = structuredClone(items);
  const links = [{ id: 'a:b', from: 'a', to: 'b' }];
  const first = layoutAxes(items, { horizontal: 'changes', vertical: 'status' });
  const second = layoutAxes([...items].reverse(), { horizontal: 'status', vertical: 'changes' });
  const before = routeAxesConnections(first, links), after = routeAxesConnections(second, links);
  assert.deepEqual(before.map(route => route.id), after.map(route => route.id));
  assertClearRoute(first, before[0].points);
  assertClearRoute(second, after[0].points);
  assert.deepEqual(items, original);
});
test('connections alongside a tall expanded card avoid all cards in their column', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ ...card(String(index).padStart(2, '0'), 'src/a.ts'), height: index === 1 ? 1600 : 140 }));
  const layout = layoutAxes(items, { horizontal: 'folder', vertical: 'status' });
  const route = routeAxesConnections(layout, [{ id: 'last:first', from: '11', to: '00' }])[0];
  assertClearRoute(layout, route.points);
  assert.ok(route.points[0].y > route.points.at(-1)!.y);
});
test('backward connections still point into the correct destination card', () => {
  const layout = layoutAxes([card('a', 'a.ts'), card('b', 'b.ts'), card('c', 'c.ts')], { horizontal: 'file', vertical: 'status' });
  const route = routeAxesConnections(layout, [{ id: 'c:a', from: 'c', to: 'a' }])[0];
  assertClearRoute(layout, route.points);
  assert.equal(route.points[0].x, layout.positions.get('c')!.x);
  assert.equal(route.points.at(-1)!.x, layout.positions.get('a')!.x + 320);
});
test('folder axes group full cards into labelled columns without stacking them on each other', () => {
  const result = layoutAxes([card('one', 'src/ui/a.ts'), card('two', 'src/core/a.ts'), card('three', 'src/ui/b.ts')], { horizontal: 'folder', vertical: 'status' });
  assert.deepEqual(result.columns.map(band => band.label), ['src/core', 'src/ui']);
  const one = result.positions.get('one')!, two = result.positions.get('two')!, three = result.positions.get('three')!;
  assert.equal(one.x, three.x);
  assert.ok(one.x >= two.x + 320, 'Different folder columns leave room for the full 320px card');
  assert.ok(three.y >= one.y + 140, 'Cards sharing a folder and row remain separate');
});

test('file axes distinguish matching basenames by their complete repository path', () => {
  const result = layoutAxes([card('ui', 'src/ui/index.ts'), card('core', 'src/core/index.ts')], { horizontal: 'file', vertical: 'status' });
  assert.deepEqual(result.columns.map(band => band.label), ['src/core/index.ts', 'src/ui/index.ts']);
  assert.notEqual(result.positions.get('ui')!.x, result.positions.get('core')!.x);
});

test('change-size columns count additions and removals together', () => {
  const ten = { ...card('ten', 'src/a.ts'), changes: { added: 10, removed: 0 } };
  const eleven = { ...card('eleven', 'src/b.ts'), changes: { added: 6, removed: 5 } };
  const result = layoutAxes([eleven, ten], { horizontal: 'changes', vertical: 'status' });
  assert.deepEqual(result.columns.map(band => band.label), ['1–10', '11–50']);
  assert.ok(result.positions.get('ten')!.x < result.positions.get('eleven')!.x);
});

test('vertical change bands put larger changes above smaller changes', () => {
  const items = [8, 50, 201].map(total => ({ ...card(String(total), 'src/a.ts'), changes: { added: total, removed: 0 } }));
  const result = layoutAxes(items, { horizontal: 'folder', vertical: 'changes' });
  assert.deepEqual(result.rows.map(band => band.label), ['201+', '11–50', '1–10']);
  assert.ok(result.positions.get('201')!.y < result.positions.get('8')!.y);
});

test('unavailable counts remain distinct from genuine zero changes', () => {
  const items = [{ ...card('zero', 'a.ts'), changes: { added: 0, removed: 0 } }, { ...card('unknown', 'b.ts'), changes: null }];
  const result = layoutAxes(items, { horizontal: 'folder', vertical: 'changes' });
  assert.deepEqual(result.rows.map(band => band.label), ['0', 'Unavailable']);
  assert.notEqual(result.positions.get('zero')!.y, result.positions.get('unknown')!.y);
  assert.equal(result.columns[0].label, 'Repository root');
});

test('a change-band upper boundary stays inclusive before the next band begins', () => {
  const items = [50, 51].map(total => ({ ...card(String(total), 'a.ts'), changes: { added: total, removed: 0 } }));
  const result = layoutAxes(items, { horizontal: 'changes', vertical: 'folder' });
  assert.deepEqual(result.columns.map(band => band.label), ['11–50', '51–200']);
});

test('a crowded band uses additional lanes without overlapping full or expanded cards', () => {
  const items = Array.from({ length: 13 }, (_, index) => ({ ...card(String(index).padStart(2, '0'), 'src/a.ts'), height: index === 12 ? 780 : 140 }));
  const result = layoutAxes(items, { horizontal: 'folder', vertical: 'status' });
  const positions = [...result.positions.values()];
  assert.equal(new Set(positions.map(position => position.x)).size, 2, 'At most twelve cards stack in one lane');
  for (const [index, a] of positions.entries()) for (const b of positions.slice(index + 1)) {
    assert.ok(a.x + 320 <= b.x || b.x + 320 <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'Cards never overlap');
  }
});

test('a large sparse file-by-folder layout remains responsive', () => {
  const items = Array.from({ length: 5000 }, (_, index) => card(String(index), `packages/module-${index}/index.ts`));
  const started = performance.now();
  const result = layoutAxes(items, { horizontal: 'file', vertical: 'folder' });
  const elapsed = performance.now() - started;
  assert.equal(result.positions.size, 5000);
  assert.ok(elapsed < 1500, `Sparse placement should finish within 1.5 seconds; took ${Math.round(elapsed)}ms`);
});

function assertClearRoute(layout: AxesLayout, points: LayoutPoint[]): void {
  assert.ok(points.length >= 4, 'A routed connection has directional endpoints');
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    assert.ok(a.x === b.x || a.y === b.y, 'Connections follow orthogonal gutters');
    for (const node of layout.positions.values()) {
      const crosses = a.x === b.x
        ? a.x > node.x && a.x < node.x + 320 && Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + node.height
        : a.y > node.y && a.y < node.y + node.height && Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + 320;
      assert.equal(crosses, false, 'Connections do not cross card content');
    }
  }
}

test('a connection crosses intermediate columns through an empty gutter instead of another card', () => {
  const layout = layoutAxes([card('a', 'a.ts'), { ...card('b', 'b.ts'), height: 600 }, card('c', 'c.ts')], { horizontal: 'file', vertical: 'status' });
  const routes = routeAxesConnections(layout, [{ id: 'a:c', from: 'a', to: 'c' }]);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].id, 'a:c');
  assertClearRoute(layout, routes[0].points);
  assert.equal(routes[0].points[0].x, layout.positions.get('a')!.x + 320);
  assert.equal(routes[0].points.at(-1)!.x, layout.positions.get('c')!.x);
});
