import type { FileSnapshot } from './git.ts';

export type FileTreeNode =
  | { kind: 'folder'; name: string; path: string; children: FileTreeNode[] }
  | { kind: 'file'; name: string; path: string; file: FileSnapshot };

export function buildFileTree(files: readonly FileSnapshot[]): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  const folders = new Map<string, Extract<FileTreeNode, { kind: 'folder' }>>();
  for (const file of files) {
    const segments = file.path.split('/');
    const name = segments.pop()!;
    let children = roots;
    let parentPath = '';
    for (const segment of segments) {
      const folderPath = parentPath ? `${parentPath}/${segment}` : segment;
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = { kind: 'folder', name: segment, path: folderPath, children: [] };
        folders.set(folderPath, folder);
        children.push(folder);
      }
      children = folder.children;
      parentPath = folderPath;
    }
    children.push({ kind: 'file', name, path: file.path, file });
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }) || left.name.localeCompare(right.name);
    });
    for (const node of nodes) if (node.kind === 'folder') sort(node.children);
  };
  sort(roots);
  return roots;
}
