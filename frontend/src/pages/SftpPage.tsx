import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type SftpAccount = {
  id: number;
  username: string;
  permission: 'rw' | 'ro';
  home: string;
  dataPath: string;
  enabled: boolean;
  notes: string | null;
};

type SftpResponse = {
  accounts: SftpAccount[];
  connection: {
    host: string;
    port: number;
    protocol: string;
    basePath: string;
    chrootNote: string;
    usernamePattern: string;
  };
};

export function SftpPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const manage = can('sftp.manage');
  const [accounts, setAccounts] = useState<SftpAccount[]>([]);
  const [connection, setConnection] = useState<SftpResponse['connection'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SftpAccount | null>(null);
  const [removeData, setRemoveData] = useState(true);
  const [form, setForm] = useState({
    username: 'sftp_',
    password: '',
    permission: 'rw' as 'rw' | 'ro',
    notes: '',
  });

  const load = async () => {
    const data = await api<SftpResponse>('/api/sftp');
    setAccounts(data.accounts);
    setConnection(data.connection);
  };

  useEffect(() => {
    void load().catch((e) => push(e.message, 'error'));
  }, [push]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/sftp', {
        method: 'POST',
        json: {
          username: form.username.trim(),
          password: form.password,
          permission: form.permission,
          notes: form.notes || undefined,
        },
      });
      push('SFTP-Account erstellt', 'success');
      setForm({ username: 'sftp_', password: '', permission: 'rw', notes: '' });
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setPermission(account: SftpAccount, permission: 'rw' | 'ro') {
    setBusy(true);
    try {
      await api(`/api/sftp/${account.id}`, { method: 'PUT', json: { permission } });
      push(`Berechtigung auf ${permission.toUpperCase()} gesetzt`, 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(account: SftpAccount) {
    setBusy(true);
    try {
      await api(`/api/sftp/${account.id}`, {
        method: 'PUT',
        json: { enabled: !account.enabled },
      });
      push(account.enabled ? 'Account gesperrt' : 'Account entsperrt', 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(account: SftpAccount) {
    const password = prompt(`Neues Passwort für ${account.username} (min. 10 Zeichen):`);
    if (!password) return;
    setBusy(true);
    try {
      await api(`/api/sftp/${account.id}/password`, { method: 'POST', json: { password } });
      push('Passwort aktualisiert', 'success');
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
          <h1>SFTP-Accounts</h1>
          <p>Chroot-SFTP ohne Shell – mit RW/RO-Berechtigung und Audit</p>
        </div>
      </div>

      {connection && (
        <div className="grid" style={{ marginBottom: '1rem' }}>
          <div className="card">
            <h3>Host</h3>
            <div className="value" style={{ fontSize: '1.05rem' }}>{connection.host}</div>
          </div>
          <div className="card">
            <h3>Port</h3>
            <div className="value">{connection.port}</div>
          </div>
          <div className="card">
            <h3>Protokoll</h3>
            <div className="value" style={{ fontSize: '1.05rem' }}>{connection.protocol.toUpperCase()}</div>
          </div>
          <div className="card">
            <h3>Datenpfad im Chroot</h3>
            <div className="value" style={{ fontSize: '1.05rem' }}>/data</div>
          </div>
        </div>
      )}

      {manage && (
        <form className="panel" style={{ marginBottom: '1rem' }} onSubmit={onCreate}>
          <div className="panel-header"><h2>SFTP-Account erstellen</h2></div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0.75rem' }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Benutzername</label>
                <input
                  className="input mono"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  pattern="sftp_[a-z0-9_]{1,27}"
                  title="Muss mit sftp_ beginnen"
                  required
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Passwort</label>
                <input
                  className="input"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  minLength={10}
                  required
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Berechtigung</label>
                <select
                  className="select"
                  value={form.permission}
                  onChange={(e) => setForm({ ...form, permission: e.target.value as 'rw' | 'ro' })}
                >
                  <option value="rw">Lesen & Schreiben (RW)</option>
                  <option value="ro">Nur Lesen (RO)</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">Notiz</label>
                <input
                  className="input"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0.9rem 0' }}>
              {connection?.chrootNote} Benutzername-Muster: <code>{connection?.usernamePattern}</code>.
              Kein SSH-Shell-Login, kein Port-Forwarding.
            </p>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Wird erstellt…' : 'Account erstellen'}
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>Accounts</h2>
          <button className="btn ghost" onClick={() => void load().catch((e) => push(e.message, 'error'))}>
            Aktualisieren
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Benutzer</th>
                <th>Berechtigung</th>
                <th>Home</th>
                <th>Status</th>
                <th>Notiz</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>Noch keine SFTP-Accounts.</td>
                </tr>
              )}
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.username}</td>
                  <td>
                    <span className={`badge ${a.permission === 'rw' ? 'ok' : 'warn'}`}>
                      {a.permission.toUpperCase()}
                    </span>
                  </td>
                  <td className="mono" style={{ whiteSpace: 'normal' }}>{a.home}<br /><span style={{ color: 'var(--muted)' }}>{a.dataPath}</span></td>
                  <td>
                    <span className={`badge ${a.enabled ? 'ok' : 'err'}`}>
                      {a.enabled ? 'aktiv' : 'gesperrt'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{a.notes || '—'}</td>
                  <td>
                    {manage && (
                      <div className="btn-row">
                        {a.permission === 'rw' ? (
                          <button className="btn" disabled={busy} onClick={() => void setPermission(a, 'ro')}>RO</button>
                        ) : (
                          <button className="btn" disabled={busy} onClick={() => void setPermission(a, 'rw')}>RW</button>
                        )}
                        <button className="btn" disabled={busy} onClick={() => void toggleEnabled(a)}>
                          {a.enabled ? 'Sperren' : 'Entsperren'}
                        </button>
                        <button className="btn" disabled={busy} onClick={() => void resetPassword(a)}>Passwort</button>
                        <button
                          className="btn danger"
                          disabled={busy}
                          onClick={() => {
                            setRemoveData(true);
                            setConfirmDelete(a);
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
        title="SFTP-Account löschen"
        message={
          confirmDelete
            ? `Account "${confirmDelete.username}" wirklich löschen?${removeData ? ' Die Dateien unter dem Home-Verzeichnis werden mitgelöscht.' : ''}`
            : ''
        }
        danger
        confirmLabel="Löschen"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const account = confirmDelete!;
          setConfirmDelete(null);
          setBusy(true);
          void (async () => {
            try {
              await api(`/api/sftp/${account.id}`, {
                method: 'DELETE',
                json: { confirm: true, removeData },
              });
              push('SFTP-Account gelöscht', 'success');
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
          <input type="checkbox" checked={removeData} onChange={(e) => setRemoveData(e.target.checked)} />
          {' '}Home-Verzeichnis / Dateien ebenfalls löschen
        </label>
      )}
    </>
  );
}
