import { diffLines } from 'diff';
import path from 'node:path';
import { contentHash, type Comparison } from './git.ts';
import { graphLanguage, parseGraphFile, type ParsedSymbol, type ParsedImport } from './graph-parser.ts';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'unchanged';
export interface LineChanges { added: number; removed: number }
export interface SymbolRange { startLine: number; endLine: number }
export interface GraphSymbol {
  id: string;
  name: string;
  qualifiedName: string;
  kind: 'class' | 'interface' | 'function' | 'method' | 'field';
  filePath: string;
  parentId?: string;
  signature: string;
  status: ChangeStatus;
  before?: SymbolRange;
  after?: SymbolRange;
  changes: LineChanges;
  detail: string;
}
export interface GraphUsage { filePath: string; line: number }
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'calls' | 'returns' | 'references' | 'extends' | 'implements';
  status: Exclude<ChangeStatus, 'modified'>;
  before?: GraphUsage;
  after?: GraphUsage;
}
export interface GraphFile {
  path: string;
  status: ChangeStatus;
  commentable?: boolean;
  changes: LineChanges | null;
  otherChanges: LineChanges | null;
  notice?: string;
}
export interface ChangeGraph {
  reviewId: string;
  symbols: GraphSymbol[];
  edges: GraphEdge[];
  files: GraphFile[];
}

export async function buildChangeGraph(review: Pick<Comparison, 'id' | 'files'>): Promise<ChangeGraph> {
  const graph: ChangeGraph = { reviewId: review.id, symbols: [], edges: [], files: [] };
  const sides: Record<'before' | 'after', SideSymbol[]> = { before: [], after: [] };
  const fileEdits = new Map<string, { before: number[]; after: number[] }>();
  for (const file of review.files) {
    const summary: GraphFile = { path: file.path, status: file.status, commentable: !file.omitted && !file.binary, changes: null, otherChanges: null };
    graph.files.push(summary);
    if (file.omitted || file.binary) { summary.notice = file.omitted ?? 'Binary file'; continue; }
    const before = file.before.replace(/\r\n/g, '\n'), after = file.after.replace(/\r\n/g, '\n');
    const edits = diffLines(before, after, { timeout: 1000 });
    if (!edits) { summary.notice = 'Line comparison exceeded its time limit. Open the file diff.'; continue; }
    const removed = new Set<number>(), added = new Set<number>();
    let oldLine = 1, newLine = 1;
    for (const edit of edits) {
      for (let index = 0; index < edit.count; index++) {
        if (edit.removed) removed.add(oldLine + index);
        if (edit.added) added.add(newLine + index);
      }
      if (!edit.added) oldLine += edit.count;
      if (!edit.removed) newLine += edit.count;
    }
    summary.changes = { added: added.size, removed: removed.size };
    summary.otherChanges = { ...summary.changes };
    if (file.beforeMode && file.afterMode && file.beforeMode !== file.afterMode) summary.notice = `File mode changed: ${file.beforeMode} → ${file.afterMode}.`;
    if (file.before !== file.after && before === after) summary.notice = 'Line endings changed.';
    const removedLines = [...removed], addedLines = [...added];
    fileEdits.set(file.path, { before: removedLines, after: addedLines });
    const language = graphLanguage(file.path);
    if (!language) { summary.notice = 'Language not supported by the graph. Open the file diff.'; continue; }
    try {
      const oldParsed = await parseGraphFile(language, before), newParsed = await parseGraphFile(language, after);
      if (oldParsed.hasErrors || newParsed.hasErrors) summary.notice = 'Partial syntax tree; some changes or usages may be unavailable.';
      if (oldParsed.truncated || newParsed.truncated) summary.notice = 'The file exceeds 20,000 symbols. Remaining changes are available in the file diff.';
      const oldGroups = groupSymbols(oldParsed.symbols), newGroups = groupSymbols(newParsed.symbols);
      const pairs: { old?: ParsedSymbol; next?: ParsedSymbol; id: string }[] = [];
      for (const key of new Set([...oldGroups.keys(), ...newGroups.keys()])) {
        const olds = [...(oldGroups.get(key) ?? [])], nexts = [...(newGroups.get(key) ?? [])];
        const matched: { old?: ParsedSymbol; next?: ParsedSymbol }[] = [];
        for (let index = olds.length - 1; index >= 0; index--) {
          const nextIndex = nexts.findIndex(symbol => symbol.signature === olds[index].signature);
          if (nextIndex >= 0) matched.push({ old: olds.splice(index, 1)[0], next: nexts.splice(nextIndex, 1)[0] });
        }
        if (olds.length === 1 && nexts.length === 1) matched.push({ old: olds.pop(), next: nexts.pop() });
        matched.push(...olds.map(old => ({ old })), ...nexts.map(next => ({ next })));
        matched.forEach((pair, index) => pairs.push({ ...pair, id: contentHash(`${file.path}\0${key}\0${index}`).slice(0, 24) }));
      }
      if (graph.symbols.length + pairs.length > 50_000) { summary.notice = 'The comparison exceeds 50,000 symbols. Open this file diff to review its changes.'; continue; }
      const owners = new Map(pairs.map(pair => [(pair.next ?? pair.old)!.key, pair.id]));
      const coveredBefore: SymbolRange[] = [], coveredAfter: SymbolRange[] = [];
      for (const pair of pairs) {
        const symbol = (pair.next ?? pair.old)!;
        const status: ChangeStatus = !pair.old ? 'added' : !pair.next ? 'deleted' : pair.old.text !== pair.next.text || pair.old.signature !== pair.next.signature ? 'modified' : 'unchanged';
        const oldChanges = status === 'unchanged' ? 0 : countLines(removedLines, pair.old?.range), newChanges = status === 'unchanged' ? 0 : countLines(addedLines, pair.next?.range);
        if (status !== 'unchanged') { if (pair.old) coveredBefore.push(pair.old.range); if (pair.next) coveredAfter.push(pair.next.range); }
        graph.symbols.push({
          id: pair.id, name: symbol.name, qualifiedName: symbol.qualifiedName, kind: symbol.kind,
          filePath: file.path, parentId: symbol.owner ? owners.get(symbol.owner) : undefined,
          signature: symbol.signature, status, before: pair.old?.range, after: pair.next?.range,
          changes: { added: newChanges, removed: oldChanges },
          detail: status !== 'modified' ? status : pair.old!.signature !== pair.next!.signature ? 'Signature changed' : symbol.kind === 'field' ? 'Field changed' : 'Body changed'
        });
        if (pair.old) sides.before.push({ id: pair.id, filePath: file.path, parsed: pair.old, imports: oldParsed.imports });
        if (pair.next) sides.after.push({ id: pair.id, filePath: file.path, parsed: pair.next, imports: newParsed.imports });
      }
      summary.otherChanges = { added: added.size - coveredLines(addedLines, coveredAfter), removed: removed.size - coveredLines(removedLines, coveredBefore) };
    } catch (error) { summary.notice = `Could not analyse this file: ${error instanceof Error ? error.message : String(error)}`; }
  }
  const classes = new Map<string, GraphSymbol[]>();
  const classesById = new Map<string, GraphSymbol>();
  const definitions = new Map<string, GraphSymbol[]>();
  for (const symbol of graph.symbols) if (symbol.kind === 'class' || symbol.kind === 'interface') { const group = classes.get(symbol.qualifiedName) ?? []; group.push(symbol); classes.set(symbol.qualifiedName, group); classesById.set(symbol.id, symbol); }
  for (const symbol of graph.symbols) if (!symbol.parentId && symbol.kind === 'function' && graphLanguage(symbol.filePath) === 'cpp' && symbol.qualifiedName.includes('.')) {
    const owners = (classes.get(symbol.qualifiedName.slice(0, symbol.qualifiedName.lastIndexOf('.'))) ?? []).filter(owner => graphLanguage(owner.filePath) === 'cpp');
    if (owners.length !== 1) continue;
    const owner = owners[0]; symbol.parentId = owner.id; symbol.kind = 'method';
    const members = definitions.get(owner.id) ?? []; members.push(symbol); definitions.set(owner.id, members);
    if (owner.status === 'unchanged' && symbol.status !== 'unchanged') { owner.status = 'modified'; owner.detail = 'Member definition changed'; }
  }
  for (const [id, members] of definitions) {
    const owner = classesById.get(id)!;
    const ranges = new Map<string, { before: SymbolRange[]; after: SymbolRange[] }>();
    for (const symbol of [owner, ...members]) {
      const group = ranges.get(symbol.filePath) ?? { before: [], after: [] };
      if (symbol.before) group.before.push(symbol.before); if (symbol.after) group.after.push(symbol.after);
      ranges.set(symbol.filePath, group);
    }
    owner.changes = { added: 0, removed: 0 };
    for (const [filePath, group] of ranges) {
      const edits = fileEdits.get(filePath)!;
      owner.changes.added += coveredLines(edits.after, group.after);
      owner.changes.removed += coveredLines(edits.before, group.before);
    }
  }
  graph.edges = resolveUsages(graph.symbols, sides);
  return graph;
}

interface SideSymbol { id: string; filePath: string; parsed: ParsedSymbol; imports: ParsedImport[] }

function resolveUsages(symbols: GraphSymbol[], sides: Record<'before' | 'after', SideSymbol[]>): GraphEdge[] {
  const byId = new Map(symbols.map(symbol => [symbol.id, symbol]));
  const edges = new Map<string, GraphEdge>();
  for (const side of ['before', 'after'] as const) {
    const names = new Map<string, GraphSymbol[]>();
    const children = new Map<string, GraphSymbol[]>();
    const parsed = new Map(sides[side].map(item => [item.id, item.parsed]));
    const paths = new Set(sides[side].map(item => item.filePath));
    for (const item of sides[side]) {
      const key = `${item.filePath}\0${item.parsed.name}`;
      const group = names.get(key) ?? []; group.push(byId.get(item.id)!); names.set(key, group);
      const symbol = byId.get(item.id)!;
      if (symbol.parentId) { const key = `${symbol.parentId}\0${symbol.name}`, group = children.get(key) ?? []; group.push(symbol); children.set(key, group); }
    }
    function lookup(name: string, item: SideSymbol): GraphSymbol[] {
      const imported = item.imports.find(binding => binding.name === name);
      if (!imported || !imported.source.startsWith('.')) return names.get(`${item.filePath}\0${name}`) ?? [];
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(item.filePath), imported.source));
      const target = [base, ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'].map(extension => base + extension)].find(candidate => paths.has(candidate));
      return target ? names.get(`${target}\0${imported.imported}`) ?? [] : [];
    }
    for (const item of sides[side]) for (const reference of item.parsed.references) {
      const source = byId.get(item.id)!;
      let owner = source.parentId ? byId.get(source.parentId) : undefined;
      while (owner && owner.kind !== 'class' && owner.kind !== 'interface') owner = owner.parentId ? byId.get(owner.parentId) : undefined;
      let candidates = lookup(reference.name, item);
      if (reference.kind !== 'calls' && !reference.member) candidates = candidates.filter(symbol => symbol.kind === 'class' || symbol.kind === 'interface');
      else if (reference.qualifier) {
        const fieldName = reference.qualifier.replace(/^(?:this|self|cls)(?:\.|->)/, '');
        const field = owner ? children.get(`${owner.id}\0${fieldName}`)?.find(symbol => symbol.kind === 'field') : undefined;
        const typeName = reference.qualifier in item.parsed.bindings ? item.parsed.bindings[reference.qualifier] : field ? parsed.get(field.id)?.typeName : reference.qualifier;
        const receivers = typeName ? lookup(typeName, item).filter(symbol => symbol.kind === 'class' || symbol.kind === 'interface') : [];
        const receiver = ['this', 'self', 'cls'].includes(reference.qualifier) ? owner : receivers.length === 1 ? receivers[0] : undefined;
        candidates = receiver ? children.get(`${receiver.id}\0${reference.name}`) ?? [] : [];
        if (reference.member) candidates = candidates.filter(symbol => symbol.kind === 'field');
      } else {
        if (reference.name in item.parsed.bindings) continue;
        const methods = owner ? candidates.filter(symbol => symbol.parentId === owner.id && symbol.kind === 'method') : [];
        candidates = methods.length ? methods : candidates.filter(symbol => symbol.kind === 'function' || symbol.kind === 'class');
      }
      if (candidates.length !== 1) continue;
      const target = candidates[0];
      const key = `${source.id}\0${target.id}\0${reference.kind}`;
      let edge = edges.get(key);
      if (!edge) { edge = { id: contentHash(key).slice(0, 24), source: source.id, target: target.id, kind: reference.kind, status: side === 'before' ? 'deleted' : 'added' }; edges.set(key, edge); }
      edge[side] ??= { filePath: item.filePath, line: reference.line };
      if (edge.before && edge.after) edge.status = 'unchanged';
    }
  }
  return [...edges.values()];
}

function groupSymbols(symbols: ParsedSymbol[]): Map<string, ParsedSymbol[]> {
  const groups = new Map<string, ParsedSymbol[]>();
  for (const symbol of symbols) { const group = groups.get(symbol.key) ?? []; group.push(symbol); groups.set(symbol.key, group); }
  return groups;
}

function countLines(lines: number[], range?: SymbolRange): number {
  if (!range) return 0;
  const lowerBound = (target: number) => { let low = 0, high = lines.length; while (low < high) { const middle = (low + high) >>> 1; if (lines[middle] < target) low = middle + 1; else high = middle; } return low; };
  return lowerBound(range.endLine + 1) - lowerBound(range.startLine);
}

function coveredLines(lines: number[], ranges: SymbolRange[]): number {
  ranges.sort((a, b) => a.startLine - b.startLine);
  let count = 0, current: SymbolRange | undefined;
  for (const range of ranges) {
    if (current && range.startLine <= current.endLine + 1) current.endLine = Math.max(current.endLine, range.endLine);
    else { if (current) count += countLines(lines, current); current = { ...range }; }
  }
  return count + countLines(lines, current);
}
