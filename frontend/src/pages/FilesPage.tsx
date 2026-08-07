import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

type Root = { path: string; label: string };

type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  mtime: string | null;
  mode: string;
  readable: boolean;
};

type ListResponse = {
  path: string;
  parent: string | null;
  entries: FileEntry[];
};

type ContentResponse = {
  path: string;
  name: string;
  size: number;
  mtime: string | null;
  encoding: 'utf-8' | 'base64' | 'none';
  mime: string;
  truncated: boolean;
  content: string | null;
  isText: boolean;
  isImage: boolean;
};

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesPage() {
  const { push } = useToast();
  const [roots, setRoots] = useState<Root[]>([]);
  const [currentPath, setCurrentPath] = useState('/var/www');
  const [listing, setListing] = useState<ListResponse | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const crumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    const items: Array<{ label: string; path: string }> = [];
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      items.push({ label: part, path: acc });
    }
    return items;
  }, [currentPath]);

  const filtered = useMemo(() => {
    const entries = listing?.entries || [];
    if (!q.trim()) return entries;
    const needle = q.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(needle));
  }, [listing, q]);

  async function loadRoots() {
    const data = await api<Root[]>('/api/files/roots');
    setRoots(data);
    if (data[0] && !data.some((r) => currentPath === r.path || currentPath.startsWith(`${r.path}/`))) {
      setCurrentPath(data[0].path);
    }
  }

  async function loadDir(path: string) {
    setLoading(true);
    setContent(null);
    try {
      const data = await api<ListResponse>(`/api/files?path=${encodeURIComponent(path)}`);
      setListing(data);
      setCurrentPath(data.path);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Ordner konnte nicht geladen werden', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function openEntry(entry: FileEntry) {
    if (entry.type === 'dir' || entry.type === 'symlink') {
      await loadDir(entry.path);
      return;
    }
    setLoading(true);
    try {
      const data = await api<ContentResponse>(`/api/files/content?path=${encodeURIComponent(entry.path)}`);
      setContent(data);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRoots()
      .then(() => loadDir(currentPath))
      .catch((e) => push(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>File Viewer</h1>
          <p>Geschützte Leseansicht für Webroots, SFTP-Daten und Logs</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {roots.map((r) => (
            <button
              key={r.path}
              className={`btn ${currentPath === r.path || currentPath.startsWith(`${r.path}/`) ? 'primary' : 'ghost'}`}
              onClick={() => void loadDir(r.path)}
            >
              {r.label}
            </button>
          ))}
          <input
            className="input"
            style={{ maxWidth: 260, marginLeft: 'auto' }}
            placeholder="Im Ordner filtern…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
            <button className="btn ghost" disabled={!listing?.parent} onClick={() => listing?.parent && void loadDir(listing.parent)}>
              ↑
            </button>
            <span className="mono" style={{ fontWeight: 500 }}>
              /
              {crumbs.map((c, idx) => (
                <span key={c.path}>
                  {idx > 0 ? '/' : ''}
                  <button
                    className="btn ghost"
                    style={{ padding: '0.1rem 0.25rem' }}
                    onClick={() => void loadDir(c.path)}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </span>
          </h2>
          {loading && <span style={{ color: 'var(--muted)' }}>Lädt…</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Typ</th>
                <th>Größe</th>
                <th>Rechte</th>
                <th>Geändert</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.path} style={{ cursor: 'pointer' }} onClick={() => void openEntry(e)}>
                  <td className="mono">
                    <span style={{ color: 'var(--muted)', marginRight: '0.4rem' }}>
                      {e.type === 'dir' ? '[dir]' : e.type === 'symlink' ? '[link]' : '[file]'}
                    </span>
                    {e.name}
                  </td>
                  <td><span className="badge muted">{e.type}</span></td>
                  <td>{e.type === 'file' ? fmtSize(e.size) : '—'}</td>
                  <td className="mono">{e.mode}</td>
                  <td>{e.mtime ? new Date(e.mtime).toLocaleString('de-DE') : '—'}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--muted)' }}>Keine Einträge</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {content && (
        <div className="panel">
          <div className="panel-header">
            <h2>
              {content.name}{' '}
              <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.85rem' }}>
                {fmtSize(content.size)} · {content.mime}
                {content.truncated ? ' · gekürzt' : ''}
              </span>
            </h2>
            <button className="btn ghost" onClick={() => setContent(null)}>Schließen</button>
          </div>
          <div className="panel-body">
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }} className="mono">
              {content.path}
            </div>
            {content.isImage && content.content && content.encoding === 'base64' && (
              <img
                src={`data:${content.mime};base64,${content.content}`}
                alt={content.name}
                style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--border)' }}
              />
            )}
            {content.mime === 'image/svg+xml' && content.content && content.encoding === 'utf-8' && (
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content.content)}`}
                alt={content.name}
                style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }}
              />
            )}
            {content.isText && content.content !== null && (
              <div className="log-view">{content.content}</div>
            )}
            {!content.isText && !(content.isImage && content.content) && content.mime !== 'image/svg+xml' && (
              <div className="empty">
                Binärdatei – Vorschau nicht verfügbar ({content.mime || 'unbekannt'}).
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
