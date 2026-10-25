import type { ChangeGraph, GraphSymbol, SymbolRange } from './change-graph.ts';
import type { Note } from './review.ts';
import { COMMENT_STATES, commentStatus, type CommentStatus } from './comment-workflow.ts';

export interface GraphComments {
  notes: Note[];
  statuses: Record<string, { id: CommentStatus; label: string }>;
  symbols: Record<string, string[]>;
  files: Record<string, string[]>;
}

export function graphComments(graph: ChangeGraph, notes: readonly Note[]): GraphComments {
  const paths = new Set(graph.files.map(file => file.path));
  const visible = notes.filter(note => note.reviewId === graph.reviewId && paths.has(note.filePath));
  if (!visible.length) return { notes: [], statuses: {}, symbols: {}, files: {} };
  const commentedFiles = new Set(visible.map(note => note.filePath));
  const symbols = new Map(graph.symbols.map(symbol => [symbol.id, symbol]));
  const locations = new Map<string, { symbol: GraphSymbol; range: SymbolRange }[]>();
  for (const symbol of graph.symbols) for (const side of ['before', 'after'] as const) {
    if (!commentedFiles.has(symbol.filePath)) continue;
    const range = symbol[side];
    if (!range) continue;
    const key = JSON.stringify([symbol.filePath, side]);
    const candidates = locations.get(key) ?? [];
    candidates.push({ symbol, range }); locations.set(key, candidates);
  }
  for (const candidates of locations.values()) candidates.sort((a, b) => (a.range.endLine - a.range.startLine) - (b.range.endLine - b.range.startLine));
  const bySymbol = new Map<string, string[]>(), byFile = new Map<string, string[]>();
  for (const note of visible) {
    const fileNotes = byFile.get(note.filePath) ?? [];
    fileNotes.push(note.id); byFile.set(note.filePath, fileNotes);
    const candidates = locations.get(JSON.stringify([note.filePath, note.side])) ?? [];
    const first = candidates.find(candidate => candidate.range.startLine <= note.startLine && candidate.range.endLine >= note.endLine);
    const visited = new Set<string>();
    if (first) for (const candidate of candidates) {
      if (candidate.range.endLine - candidate.range.startLine > first.range.endLine - first.range.startLine) break;
      if (candidate.range.startLine > note.startLine || candidate.range.endLine < note.endLine) continue;
      let owner: GraphSymbol | undefined = candidate.symbol;
      while (owner && !visited.has(owner.id)) {
        visited.add(owner.id);
        const symbolNotes = bySymbol.get(owner.id) ?? [];
        symbolNotes.push(note.id); bySymbol.set(owner.id, symbolNotes);
        owner = owner.parentId ? symbols.get(owner.parentId) : undefined;
      }
    }
  }
  const statuses = Object.fromEntries(visible.map(note => {
    const state = COMMENT_STATES.find(state => state.id === commentStatus(note))!;
    return [note.id, { id: state.id, label: state.label }];
  }));
  return { notes: visible, statuses, symbols: Object.fromEntries(bySymbol), files: Object.fromEntries(byFile) };
}
