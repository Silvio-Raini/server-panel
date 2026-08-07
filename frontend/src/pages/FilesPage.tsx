import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

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
  editable: boolean;
};

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function joinPath(dir: string, name: string) {
  if (dir === '/') return `/${name}`;
  return `${dir}/${name}`;
}

export function FilesPage() {
  const { can } = useAuth();
  const manage = can('files.manage');
  const { push } = useToast();
  const [roots, setRoots] = useState<Root[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [listing, setListing] = useState<ListResponse | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null);
  const [recursiveDelete, setRecursiveDelete] = useState(false);

  const crumbs = useMemo(() => {
    if (currentPath === '/') return [{ label: '/', path: '/' }];
    const parts = currentPath.split('/').filter(Boolean);
    const items: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
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

  const dirty = Boolean(content && editing && draft !== (content.content || ''));

  async function loadDir(path: string) {
    setLoading(true);
    setContent(null);
    setEditing(false);
    setDraft('');
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
    if (entry.type === 'dir') {
      await loadDir(entry.path);
      return;
    }
    if (entry.type === 'symlink') {
      // try as dir first, then file
      try {
        await loadDir(entry.path);
        return;
      } catch {
        /* fallthrough */
      }
    }
    setLoading(true);
    try {
      const data = await api<ContentResponse>(`/api/files/content?path=${encodeURIComponent(entry.path)}`);
      setContent(data);
      setDraft(data.content || '');
      setEditing(false);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function saveFile() {
    if (!content) return;
    setBusy(true);
    try {
      const data = await api<ContentResponse>('/api/files/content', {
        method: 'PUT',
        json: { path: content.path, content: draft },
      });
      setContent(data);
      setDraft(data.content || '');
      setEditing(false);
      push('Datei gespeichert', 'success');
      await loadDir(currentPath);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Speichern fehlgeschlagen', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createItem(type: 'file' | 'dir') {
    const name = prompt(type === 'dir' ? 'Neuer Ordnername:' : 'Neuer Dateiname:');
    if (!name || !name.trim()) return;
    if (name.includes('/') || name.includes('..')) {
      push('Ungültiger Name', 'error');
      return;
    }
    const path = joinPath(currentPath, name.trim());
    setBusy(true);
    try {
      await api('/api/files', {
        method: 'POST',
        json: { path, type, content: type === 'file' ? '' : undefined },
      });
      push(type === 'dir' ? 'Ordner erstellt' : 'Datei erstellt', 'success');
      await loadDir(currentPath);
      if (type === 'file') {
        await openEntry({
          name: name.trim(),
          path,
          type: 'file',
          size: 0,
          mtime: null,
          mode: '644',
          readable: true,
        });
        setEditing(true);
      }
    } catch (err) {
      push(err instanceof Error ? err.message : 'Erstellen fehlgeschlagen', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function renameEntry(entry: FileEntry) {
    const name = prompt('Neuer Name:', entry.name);
    if (!name || !name.trim() || name.trim() === entry.name) return;
    if (name.includes('/') || name.includes('..')) {
      push('Ungültiger Name', 'error');
      return;
    }
    const to = joinPath(currentPath, name.trim());
    setBusy(true);
    try {
      await api('/api/files/rename', { method: 'POST', json: { from: entry.path, to } });
      push('Umbenannt', 'success');
      if (content?.path === entry.path) setContent(null);
      await loadDir(currentPath);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Umbenennen fehlgeschlagen', 'error');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void api<Root[]>('/api/files/roots')
      .then((data) => {
        setRoots(data);
        return loadDir('/');
      })
      .catch((e) => push(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>File Manager</h1>
          <p>Vollständiges Dateisystem ab / – ansehen, bearbeiten, speichern, löschen</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {roots.map((r) => (
            <button
              key={r.path}
              className={`btn ${currentPath === r.path || (r.path !== '/' && currentPath.startsWith(`${r.path}/`)) ? 'primary' : 'ghost'}`}
              onClick={() => void loadDir(r.path)}
            >
              {r.label}
            </button>
          ))}
          <input
            className="input"
            style={{ maxWidth: 220, marginLeft: 'auto' }}
            placeholder="Filtern…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {manage && (
            <>
              <button className="btn" disabled={busy} onClick={() => void createItem('file')}>
                Neue Datei
              </button>
              <button className="btn" disabled={busy} onClick={() => void createItem('dir')}>
                Neuer Ordner
              </button>
            </>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
            <button
              className="btn ghost"
              disabled={!listing?.parent && currentPath === '/'}
              onClick={() => listing?.parent != null && void loadDir(listing.parent)}
            >
              ↑
            </button>
            <span className="mono" style={{ fontWeight: 500, display: 'flex', flexWrap: 'wrap', gap: '0.15rem' }}>
              {crumbs.map((c, idx) => (
                <span key={c.path}>
                  {idx > 1 ? '/' : idx === 1 ? '' : ''}
                  <button className="btn ghost" style={{ padding: '0.1rem 0.25rem' }} onClick={() => void loadDir(c.path)}>
                    {c.label}
                  </button>
                  {idx === 0 && crumbs.length > 1 ? '' : null}
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
                {manage && <th>Aktionen</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.path}>
                  <td className="mono" style={{ cursor: 'pointer' }} onClick={() => void openEntry(e)}>
                    <span style={{ color: 'var(--muted)', marginRight: '0.4rem' }}>
                      {e.type === 'dir' ? '[dir]' : e.type === 'symlink' ? '[link]' : '[file]'}
                    </span>
                    {e.name}
                  </td>
                  <td><span className="badge muted">{e.type}</span></td>
                  <td>{e.type === 'file' ? fmtSize(e.size) : '—'}</td>
                  <td className="mono">{e.mode}</td>
                  <td>{e.mtime ? new Date(e.mtime).toLocaleString('de-DE') : '—'}</td>
                  {manage && (
                    <td>
                      <div className="btn-row">
                        <button className="btn ghost" disabled={busy} onClick={() => void renameEntry(e)}>
                          Umbenennen
                        </button>
                        <button
                          className="btn danger"
                          disabled={busy}
                          onClick={() => {
                            setRecursiveDelete(e.type === 'dir');
                            setConfirmDelete(e);
                          }}
                        >
                          Löschen
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={manage ? 6 : 5} style={{ color: 'var(--muted)' }}>Keine Einträge</td>
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
                {dirty ? ' · ungespeichert' : ''}
              </span>
            </h2>
            <div className="btn-row">
              {manage && content.editable && !editing && (
                <button className="btn" onClick={() => setEditing(true)}>Bearbeiten</button>
              )}
              {manage && content.editable && editing && (
                <>
                  <button className="btn primary" disabled={busy || !dirty} onClick={() => void saveFile()}>
                    Speichern
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => {
                      setDraft(content.content || '');
                      setEditing(false);
                    }}
                  >
                    Abbrechen
                  </button>
                </>
              )}
              {manage && (
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() => {
                    setRecursiveDelete(false);
                    setConfirmDelete({
                      name: content.name,
                      path: content.path,
                      type: 'file',
                      size: content.size,
                      mtime: content.mtime,
                      mode: '644',
                      readable: true,
                    });
                  }}
                >
                  Löschen
                </button>
              )}
              <button className="btn ghost" onClick={() => { setContent(null); setEditing(false); }}>
                Schließen
              </button>
            </div>
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
            {content.mime === 'image/svg+xml' && content.content && content.encoding === 'utf-8' && !editing && (
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content.content)}`}
                alt={content.name}
                style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }}
              />
            )}
            {content.isText && content.content !== null && !editing && (
              <div className="log-view">{content.content}</div>
            )}
            {editing && (
              <textarea
                className="input file-editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
            )}
            {!content.isText && !(content.isImage && content.content) && content.mime !== 'image/svg+xml' && !editing && (
              <div className="empty">Binärdatei – Vorschau nicht verfügbar ({content.mime || 'unbekannt'}).</div>
            )}
            {manage && content.isText && !content.editable && (
              <div className="empty">Datei ist zu groß oder gekürzt und kann hier nicht bearbeitet werden.</div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Löschen bestätigen"
        message={
          confirmDelete
            ? `"${confirmDelete.path}" wirklich löschen?${confirmDelete.type === 'dir' && recursiveDelete ? ' Der Ordner wird rekursiv gelöscht.' : ''}`
            : ''
        }
        danger
        confirmLabel="Löschen"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const entry = confirmDelete!;
          setConfirmDelete(null);
          setBusy(true);
          void (async () => {
            try {
              await api('/api/files', {
                method: 'DELETE',
                json: {
                  path: entry.path,
                  confirm: true,
                  recursive: entry.type === 'dir' ? recursiveDelete : false,
                },
              });
              push('Gelöscht', 'success');
              if (content?.path === entry.path) {
                setContent(null);
                setEditing(false);
              }
              await loadDir(currentPath);
            } catch (err) {
              push(err instanceof Error ? err.message : 'Löschen fehlgeschlagen', 'error');
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
      {confirmDelete?.type === 'dir' && (
        <label
          style={{
            position: 'fixed',
            bottom: '1.2rem',
            left: '1.2rem',
            zIndex: 45,
            background: '#121a2b',
            padding: '0.6rem 0.8rem',
            borderRadius: 10,
            border: '1px solid var(--border)',
          }}
        >
          <input
            type="checkbox"
            checked={recursiveDelete}
            onChange={(e) => setRecursiveDelete(e.target.checked)}
          />{' '}
          Rekursiv löschen (inkl. Inhalt)
        </label>
      )}
    </>
  );
}
