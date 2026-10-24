import type { FileSnapshot } from './git.ts';
import { buildFileTree, type FileTreeNode } from './file-tree.ts';

export interface ReviewFileTarget { path: string; position: number; total: number }

export function adjacentReviewFile(files: readonly FileSnapshot[], currentPath: string, direction: -1 | 1): ReviewFileTarget | undefined {
  const paths = (nodes: FileTreeNode[]): string[] => nodes.flatMap(node => node.kind === 'folder' ? paths(node.children) : [node.path]);
  const ordered = paths(buildFileTree(files));
  const current = ordered.indexOf(currentPath);
  if (ordered.length < 2 || current < 0) return undefined;
  const next = (current + direction + ordered.length) % ordered.length;
  return { path: ordered[next], position: next + 1, total: ordered.length };
}
