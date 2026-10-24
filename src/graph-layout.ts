export type GraphAxis = 'folder' | 'file' | 'changes' | 'status';
export interface AxesSettings { horizontal: GraphAxis; vertical: GraphAxis }
export interface AxisCard {
  id: string;
  filePath: string;
  label?: string;
  status: string;
  changes: { added: number; removed: number } | null;
  height: number;
}
export interface AxisBand { key: string; label: string; start: number; size: number }
export interface AxisPosition {
  x: number; y: number; height: number; column: number; row: number;
  leftLane: number; rightLane: number; aboveLane: number; belowLane: number;
}
export interface AxesLayout {
  positions: Map<string, AxisPosition>;
  columns: AxisBand[];
  rows: AxisBand[];
  width: number;
  height: number;
}
export interface LayoutConnection { id: string; from: string; to: string }
export interface LayoutPoint { x: number; y: number }
export interface LayoutRoute { id: string; points: LayoutPoint[] }

export function routeAxesConnections(layout: AxesLayout, connections: readonly LayoutConnection[]): LayoutRoute[] {
  const routes: LayoutRoute[] = [];
  for (const [index, connection] of connections.entries()) {
    const from = layout.positions.get(connection.from), to = layout.positions.get(connection.to);
    if (!from || !to) continue;
    const forward = to.x > from.x, sameColumn = to.x === from.x;
    const offset = (index % 5 - 2) * 6;
    const start = { x: from.x + (forward || sameColumn ? cardWidth : 0), y: from.y + Math.min(from.height - 1, 25 + index % 3 * 8) };
    const end = { x: to.x + (forward ? 0 : cardWidth), y: to.y + Math.min(to.height - 1, 45 + index % 3 * 8) };
    const sourceLane = (forward || sameColumn ? from.rightLane : from.leftLane) + offset;
    const targetLane = (forward ? to.leftLane : to.rightLane) + offset;
    let points: LayoutPoint[];
    if (sourceLane === targetLane) points = [start, { x: sourceLane, y: start.y }, { x: targetLane, y: end.y }, end];
    else {
      const corridors = [from.aboveLane, from.belowLane, to.aboveLane, to.belowLane].map(y => y + offset);
      const corridor = corridors.reduce((best, y) => Math.abs(start.y - y) + Math.abs(end.y - y) < Math.abs(start.y - best) + Math.abs(end.y - best) ? y : best);
      points = [start, { x: sourceLane, y: start.y }, { x: sourceLane, y: corridor }, { x: targetLane, y: corridor }, { x: targetLane, y: end.y }, end];
    }
    routes.push({ id: connection.id, points });
  }
  return routes;
}

const cardWidth = 320, columnGap = 128, cardGap = 48, rowGap = 96, margin = 96;
const cardsPerLane = 12;
const statusOrder = ['added', 'modified', 'deleted', 'unchanged'];
const statusLabels: Record<string, string> = { added: 'Added', modified: 'Modified', deleted: 'Removed', unchanged: 'Unchanged' };
const changeBands = [
  { key: '0', label: '0', maximum: 0 },
  { key: '1', label: '1–10', maximum: 10 },
  { key: '11', label: '11–50', maximum: 50 },
  { key: '51', label: '51–200', maximum: 200 },
  { key: '201', label: '201+', maximum: Infinity },
  { key: 'unknown', label: 'Unavailable', maximum: NaN }
];

function axisKey(card: AxisCard, axis: GraphAxis): string {
  if (axis === 'file') return card.filePath;
  if (axis === 'folder') {
    const path = card.filePath.replaceAll('\\', '/');
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
  }
  if (axis === 'status') return card.status;
  if (!card.changes) return 'unknown';
  const total = card.changes.added + card.changes.removed;
  return changeBands.find(band => total <= band.maximum)?.key ?? 'unknown';
}

function axisLabel(key: string, axis: GraphAxis): string {
  return axis === 'folder' && !key ? 'Repository root' : axis === 'status' ? statusLabels[key] ?? key : axis === 'changes' ? changeBands.find(band => band.key === key)!.label : key;
}

function orderedKeys(cards: readonly AxisCard[], axis: GraphAxis, vertical = false): string[] {
  const keys = [...new Set(cards.map(card => axisKey(card, axis)))];
  return keys.sort((a, b) => {
    if (axis === 'status') return statusOrder.indexOf(a) - statusOrder.indexOf(b);
    if (axis !== 'changes') return a.localeCompare(b);
    if (a === 'unknown' || b === 'unknown') return a === 'unknown' ? 1 : -1;
    return (changeBands.findIndex(band => band.key === a) - changeBands.findIndex(band => band.key === b)) * (vertical ? -1 : 1);
  });
}

export function layoutAxes(cards: readonly AxisCard[], axes: AxesSettings): AxesLayout {
  const result: AxesLayout = { positions: new Map(), columns: [], rows: [], width: 0, height: 0 };
  if (!cards.length) return result;
  const xs = orderedKeys(cards, axes.horizontal), ys = orderedKeys(cards, axes.vertical, true);
  const cells = new Map<string, Map<string, AxisCard[]>>();
  for (const card of [...cards].sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.label ?? a.id).localeCompare(b.label ?? b.id))) {
    const x = axisKey(card, axes.horizontal), y = axisKey(card, axes.vertical);
    const row = cells.get(y) ?? new Map<string, AxisCard[]>(), cell = row.get(x) ?? [];
    cell.push(card); row.set(x, cell); cells.set(y, row);
  }
  const cellHeight = (cell: AxisCard[]) => {
    const heights: number[] = [];
    for (const [index, card] of cell.entries()) { const lane = Math.floor(index / cardsPerLane); heights[lane] = (heights[lane] ?? 0) + card.height + (index % cardsPerLane ? cardGap : 0); }
    return Math.max(0, ...heights);
  };
  const columnLanes = new Map<string, number>(), rowHeights = new Map<string, number>();
  for (const [y, row] of cells) for (const [x, cell] of row) {
    columnLanes.set(x, Math.max(columnLanes.get(x) ?? 0, Math.ceil(cell.length / cardsPerLane)));
    rowHeights.set(y, Math.max(rowHeights.get(y) ?? 0, cellHeight(cell)));
  }
  let columnStart = margin;
  for (const key of xs) {
    const lanes = columnLanes.get(key)!;
    const size = lanes * (cardWidth + columnGap) - columnGap;
    result.columns.push({ key, label: axisLabel(key, axes.horizontal), start: columnStart, size });
    columnStart += size + columnGap;
  }
  const columnIndices = new Map(xs.map((key, index) => [key, index]));
  let rowStart = margin;
  for (const [row, y] of ys.entries()) {
    const rowHeight = rowHeights.get(y)!;
    result.rows.push({ key: y, label: axisLabel(y, axes.vertical), start: rowStart, size: rowHeight });
    for (const [x, cell] of [...cells.get(y)!].sort((a, b) => columnIndices.get(a[0])! - columnIndices.get(b[0])!)) {
      const column = columnIndices.get(x)!;
      const tops: number[] = [];
      for (const [index, card] of cell.entries()) {
        const lane = Math.floor(index / cardsPerLane), top = rowStart + (tops[lane] ?? 0);
        const left = result.columns[column].start + lane * (cardWidth + columnGap);
        result.positions.set(card.id, { x: left, y: top, height: card.height, column, row,
          leftLane: left - columnGap / 2, rightLane: left + cardWidth + columnGap / 2,
          aboveLane: rowStart - rowGap / 2, belowLane: rowStart + rowHeight + rowGap / 2 });
        tops[lane] = (tops[lane] ?? 0) + card.height + cardGap;
      }
    }
    rowStart += rowHeight + rowGap;
  }
  result.width = result.columns.at(-1)!.start + result.columns.at(-1)!.size + margin;
  result.height = result.rows.at(-1)!.start + result.rows.at(-1)!.size + margin;
  return result;
}
