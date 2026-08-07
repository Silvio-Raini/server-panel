import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DirPicker } from '../components/DirPicker';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type DomainType = 'static' | 'proxy' | 'redirect';

type Domain = {
  id: number;
  domain: string;
  type: DomainType;
  target: string;
  aliases: string[];
  enabled: boolean;
  ssl_enabled: boolean;
  ssl_status: 'none' | 'pending' | 'active' | 'failed';
  ssl_error: string | null;
  auto_ssl: boolean;
  notes: string | null;
  protected: boolean;
};

type DomainsResponse = {
  domains: Domain[];
  allowedRoots: string[];
};

const emptyForm = {
  domain: '',
  type: 'proxy' as DomainType,
  target: '',
  aliases: '',
  autoSsl: true,
  notes: '',
};

export function DomainsPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const manage = can('domains.manage');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Domain | null>(null);
  const [deleteCert, setDeleteCert] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = async () => {
    const data = await api<DomainsResponse>('/api/domains');
    setDomains(data.domains);
    setRoots(data.allowedRoots);
  };

  useEffect(() => {
    void load().catch((e) => push(e.message, 'error'));
  }, [push]);

  function targetHint(type: DomainType) {
    if (type === 'static') return `Document-Root, z.B. ${roots[0] || '/var/www'}/meine-seite`;
    if (type === 'proxy') return 'Port oder 127.0.0.1:PORT, z.B. 8080';
    return 'Ziel-URL, z.B. https://example.com';
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/domains', {
        method: 'POST',
        json: {
          domain: form.domain.trim(),
          type: form.type,
          target: form.target.trim(),
          aliases: form.aliases
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          autoSsl: form.autoSsl,
          notes: form.notes || undefined,
        },
      });
      push(form.autoSsl ? 'Domain verbunden – SSL wird angefordert' : 'Domain verbunden', 'success');
      setForm(emptyForm);
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function requestSsl(d: Domain) {
    setBusy(true);
    try {
      await api(`/api/domains/${d.id}/ssl`, { method: 'POST', json: {} });
      push('SSL-Zertifikat ausgestellt', 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Certbot fehlgeschlagen', 'error');
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function reapply(d: Domain) {
    setBusy(true);
    try {
      await api(`/api/domains/${d.id}/reapply`, { method: 'POST', json: {} });
      push('nginx-Config neu geschrieben', 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Domains</h1>
          <p>Domains mit Ordnern, Ports oder Redirects verbinden – inkl. automatischem Certbot/SSL</p>
        </div>
      </div>

      {manage && (
        <form className="panel" style={{ marginBottom: '1rem' }} onSubmit={onCreate}>
          <div className="panel-header">
            <h2>Domain verbinden</h2>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '0.75rem' }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Domain</label>
                <input
                  className="input"
                  placeholder="app.example.com"
                  value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                  required
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Typ</label>
                <select
                  className="select"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as DomainType, target: '' })}
                >
                  <option value="proxy">Reverse Proxy (Port/App)</option>
                  <option value="static">Statischer Ordner</option>
                  <option value="redirect">Redirect</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Ziel</label>
                {form.type === 'static' ? (
                  <div className="dir-picker-field">
                    <input
                      className="input"
                      placeholder={targetHint(form.type)}
                      value={form.target}
                      onChange={(e) => setForm({ ...form, target: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setPickerOpen(true)}
                      title="Ordner im Tree auswählen"
                    >
                      Ordner wählen
                    </button>
                  </div>
                ) : (
                  <input
                    className="input"
                    placeholder={targetHint(form.type)}
                    value={form.target}
                    onChange={(e) => setForm({ ...form, target: e.target.value })}
                    required
                  />
                )}
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Aliases (optional, kommagetrennt)</label>
                <input
                  className="input"
                  placeholder="www.example.com"
                  value={form.aliases}
                  onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: '0.9rem' }}>
              <label className="label">Notiz (optional)</label>
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={form.autoSsl}
                onChange={(e) => setForm({ ...form, autoSsl: e.target.checked })}
              />
              Automatisch Let&apos;s Encrypt Zertifikat per Certbot holen
            </label>
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
              Erlaubte Document-Roots: {roots.join(', ') || '—'}. DNS der Domain muss auf diesen Server zeigen, bevor SSL funktioniert.
            </div>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Wird eingerichtet…' : 'Domain verbinden'}
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>Verbundene Domains</h2>
          <button className="btn ghost" onClick={() => void load().catch((e) => push(e.message, 'error'))}>
            Aktualisieren
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Typ</th>
                <th>Ziel</th>
                <th>SSL</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {domains.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    Noch keine Domains verbunden.
                  </td>
                </tr>
              )}
              {domains.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="mono">{d.domain}</div>
                    {d.aliases.length > 0 && (
                      <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{d.aliases.join(', ')}</div>
                    )}
                    {d.notes && <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{d.notes}</div>}
                  </td>
                  <td>
                    <span className="badge muted">
                      {d.type === 'proxy' ? 'Proxy' : d.type === 'static' ? 'Ordner' : 'Redirect'}
                    </span>
                  </td>
                  <td className="mono" style={{ whiteSpace: 'normal', maxWidth: 260 }}>
                    {d.target}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        d.ssl_status === 'active'
                          ? 'ok'
                          : d.ssl_status === 'failed'
                            ? 'err'
                            : d.ssl_status === 'pending'
                              ? 'warn'
                              : 'muted'
                      }`}
                    >
                      {d.ssl_status}
                    </span>
                    {d.ssl_error && (
                      <div style={{ color: '#fda4af', fontSize: '0.75rem', maxWidth: 220, whiteSpace: 'normal' }}>
                        {d.ssl_error}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${d.enabled ? 'ok' : 'muted'}`}>
                      {d.enabled ? 'aktiv' : 'deaktiviert'}
                    </span>
                  </td>
                  <td>
                    {manage && !d.protected && (
                      <div className="btn-row">
                        {d.ssl_status !== 'active' && (
                          <button className="btn" disabled={busy} onClick={() => void requestSsl(d)}>
                            SSL holen
                          </button>
                        )}
                        <button className="btn ghost" disabled={busy} onClick={() => void reapply(d)}>
                          Neu anwenden
                        </button>
                        <a className="btn ghost" href={`http://${d.domain}`} target="_blank" rel="noreferrer">
                          Öffnen
                        </a>
                        <button
                          className="btn danger"
                          disabled={busy}
                          onClick={() => {
                            setDeleteCert(false);
                            setConfirmDelete(d);
                          }}
                        >
                          Löschen
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Domain entfernen"
        message={
          confirmDelete
            ? `Domain "${confirmDelete.domain}" wirklich entfernen? Die nginx-Konfiguration wird gelöscht.`
            : ''
        }
        danger
        confirmLabel="Entfernen"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const d = confirmDelete!;
          setConfirmDelete(null);
          setBusy(true);
          void (async () => {
            try {
              await api(`/api/domains/${d.id}`, {
                method: 'DELETE',
                json: { confirm: true, deleteCert },
              });
              push('Domain entfernt', 'success');
              await load();
            } catch (err) {
              push(err instanceof Error ? err.message : 'Fehler', 'error');
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
      {confirmDelete && (
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
          <input type="checkbox" checked={deleteCert} onChange={(e) => setDeleteCert(e.target.checked)} /> Auch
          Let&apos;s-Encrypt-Zertifikat löschen
        </label>
      )}

      <DirPicker
        open={pickerOpen}
        roots={roots}
        value={form.target || roots[0] || '/var/www'}
        title="Document-Root auswählen"
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => setForm((prev) => ({ ...prev, target: path }))}
      />
    </>
  );
}
