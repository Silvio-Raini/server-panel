import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toast';

type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
};

type ListResponse = {
  path: string;
  parent: string | null;
  entries: FileEntry[];
};

type TreeNode = {
  path: string;
  name: string;
  children?: TreeNode[];
  loaded?: boolean;
  loading?: boolean;
  expanded?: boolean;
};

type Props = {
  open: boolean;
  roots: string[];
  value?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  title?: string;
};

function isDirEntry(e: FileEntry): boolean {
  return e.type === 'dir' || e.type === 'symlink';
}

export function DirPicker({
  open,
  roots,
  value,
  onSelect,
  onClose,
  title = 'Ordner auswählen',
}: Props) {
  const { push } = useToast();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState(value || '');
  const [filter, setFilter] = useState('');
  const [busyPath, setBusyPath] = useState('');

  const allowedRoots = useMemo(
    () => (roots.length ? roots : ['/var/www', '/opt/sites', '/srv/www']),
    [roots],
  );

  const loadChildren = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const data = await api<ListResponse>(`/api/files?path=${encodeURIComponent(dirPath)}`);
    return data.entries
      .filter(isDirEntry)
      .map((e) => ({
        path: e.path,
        name: e.name,
        children: [],
        loaded: false,
        expanded: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(value || allowedRoots[0] || '');
    setFilter('');
    setTree(
      allowedRoots.map((root) => ({
        path: root,
        name: root,
        children: [],
        loaded: false,
        expanded: false,
      })),
    );
  }, [open, allowedRoots, value]);

  async function toggleNode(path: string) {
    let shouldLoad = false;
    let shouldCollapse = false;

    setTree((prev) => {
      const current = findNode(prev, path);
      if (!current) return prev;
      if (current.expanded) {
        shouldCollapse = true;
        return updateNode(prev, path, (node) => ({ ...node, expanded: false, loading: false }));
      }
      if (!current.loaded) {
        shouldLoad = true;
        return updateNode(prev, path, (node) => ({ ...node, loading: true }));
      }
      return updateNode(prev, path, (node) => ({ ...node, expanded: true }));
    });

    if (shouldCollapse || !shouldLoad) return;

    setBusyPath(path);
    try {
      const children = await loadChildren(path);
      setTree((prev) =>
        updateNode(prev, path, (node) => ({
          ...node,
          children,
          loaded: true,
          expanded: true,
          loading: false,
        })),
      );
    } catch (err) {
      push(err instanceof Error ? err.message : 'Ordner konnte nicht geladen werden', 'error');
      setTree((prev) => updateNode(prev, path, (node) => ({ ...node, loading: false })));
    } finally {
      setBusyPath('');
    }
  }

  const visibleTree = useMemo(() => {
    if (!filter.trim()) return tree;
    return filterTree(tree, filter.trim().toLowerCase());
  }, [tree, filter]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal dir-picker-modal">
        <h3>{title}</h3>
        <p>Nur erlaubte Document-Roots. ▸ klappt auf, Klick wählt den Ordner.</p>

        <div className="field">
          <label className="label">Suche im Baum</label>
          <input
            className="input"
            placeholder="Ordnername filtern…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="dir-picker-selected mono">
          Ausgewählt: <strong>{selected || '—'}</strong>
        </div>

        <div className="dir-tree">
          {visibleTree.map((node) => (
            <DirTreeNode
              key={node.path}
              node={node}
              depth={0}
              selected={selected}
              busyPath={busyPath}
              onToggle={(p) => void toggleNode(p)}
              onSelect={setSelected}
            />
          ))}
          {visibleTree.length === 0 && <div className="empty">Keine Ordner gefunden.</div>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onSelect(selected);
              onClose();
            }}
          >
            Ordner übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}

function DirTreeNode({
  node,
  depth,
  selected,
  busyPath,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  busyPath: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isSelected = selected === node.path;

  return (
    <div>
      <div
        className={`dir-tree-row${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }}
      >
        <button
          type="button"
          className="dir-tree-toggle"
          onClick={() => onToggle(node.path)}
          title={node.expanded ? 'Einklappen' : 'Aufklappen'}
        >
          {busyPath === node.path || node.loading ? '…' : node.expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className="dir-tree-label mono"
          onClick={() => onSelect(node.path)}
          onDoubleClick={() => {
            onSelect(node.path);
            onToggle(node.path);
          }}
        >
          <span className="dir-tree-icon">[dir]</span> {node.name}
        </button>
      </div>
      {node.expanded &&
        (node.children || []).map((child) => (
          <DirTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            busyPath={busyPath}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
      {node.expanded && node.loaded && (node.children || []).length === 0 && (
        <div className="dir-tree-empty" style={{ paddingLeft: `${1.6 + depth * 1.1}rem` }}>
          Keine Unterordner
        </div>
      )}
    </div>
  );
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children?.length) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function updateNode(nodes: TreeNode[], path: string, updater: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return updater(node);
    if (node.children?.length) {
      return { ...node, children: updateNode(node.children, path, updater) };
    }
    return node;
  });
}

function filterTree(nodes: TreeNode[], needle: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const childMatches = node.children ? filterTree(node.children, needle) : [];
    const selfMatch =
      node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle);
    if (selfMatch || childMatches.length) {
      out.push({
        ...node,
        expanded: true,
        children: childMatches.length ? childMatches : node.children,
      });
    }
  }
  return out;
}
