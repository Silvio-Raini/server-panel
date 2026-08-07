import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type LinuxUser = {
  username: string;
  uid: number;
  primaryGroup: string;
  home: string;
  shell: string;
  locked: boolean;
  lastLogin: string | null;
  groups: string[];
  system: boolean;
};

export function UsersPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const manage = can('users.manage');
  const [users, setUsers] = useState<LinuxUser[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [removeHome, setRemoveHome] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', shell: '/bin/bash' });

  const load = async () => setUsers(await api<LinuxUser[]>('/api/users'));

  useEffect(() => {
    void load().catch((e) => push(e.message, 'error'));
  }, [push]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/api/users', { method: 'POST', json: form });
      push('Benutzer erstellt', 'success');
      setForm({ username: '', password: '', shell: '/bin/bash' });
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    }
  }

  async function act(path: string, json: unknown = {}) {
    try {
      await api(path, { method: 'POST', json });
      push('Aktion erfolgreich', 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Benutzer</h1>
          <p>Lokale Linux-Benutzerverwaltung</p>
        </div>
      </div>

      {manage && (
        <form className="panel" style={{ marginBottom: '1rem' }} onSubmit={createUser}>
          <div className="panel-header"><h2>Benutzer erstellen</h2></div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '0.75rem' }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Benutzername</label>
              <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Passwort</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">Shell</label>
              <input className="input" value={form.shell} onChange={(e) => setForm({ ...form, shell: e.target.value })} />
            </div>
            <div style={{ alignSelf: 'end' }}>
              <button className="btn primary">Erstellen</button>
            </div>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Benutzer</th><th>UID</th><th>Gruppe</th><th>Home</th><th>Shell</th><th>Status</th><th>Letzte Anmeldung</th><th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username}>
                  <td className="mono">{u.username}</td>
                  <td>{u.uid}</td>
                  <td>{u.primaryGroup}</td>
                  <td className="mono">{u.home}</td>
                  <td className="mono">{u.shell}</td>
                  <td><span className={`badge ${u.locked ? 'warn' : 'ok'}`}>{u.locked ? 'gesperrt' : 'aktiv'}</span></td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 180 }}>{u.lastLogin || '—'}</td>
                  <td>
                    {manage && !u.system && (
                      <div className="btn-row">
                        {u.locked
                          ? <button className="btn" onClick={() => void act(`/api/users/${u.username}/unlock`)}>Entsperren</button>
                          : <button className="btn" onClick={() => void act(`/api/users/${u.username}/lock`)}>Sperren</button>}
                        <button
                          className="btn"
                          onClick={() => {
                            const password = prompt(`Neues Passwort für ${u.username} (min. 8 Zeichen):`);
                            if (password) void act(`/api/users/${u.username}/password`, { password });
                          }}
                        >
                          Passwort
                        </button>
                        <button className="btn danger" onClick={() => { setRemoveHome(false); setConfirmDelete(u.username); }}>Löschen</button>
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
        title="Benutzer löschen"
        message={confirmDelete ? `Benutzer "${confirmDelete}" wirklich löschen?${removeHome ? ' Das Home-Verzeichnis wird mitgelöscht.' : ''}` : ''}
        danger
        confirmLabel="Löschen"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const username = confirmDelete!;
          setConfirmDelete(null);
          void (async () => {
            try {
              await api(`/api/users/${username}`, { method: 'DELETE', json: { confirm: true, removeHome } });
              push('Benutzer gelöscht', 'success');
              await load();
            } catch (err) {
              push(err instanceof Error ? err.message : 'Fehler', 'error');
            }
          })();
        }}
      />
      {confirmDelete && (
        <label style={{ position: 'fixed', bottom: '1.2rem', left: '1.2rem', zIndex: 45, background: '#121a2b', padding: '0.6rem 0.8rem', borderRadius: 10, border: '1px solid var(--border)' }}>
          <input type="checkbox" checked={removeHome} onChange={(e) => setRemoveHome(e.target.checked)} /> Home-Verzeichnis ebenfalls löschen
        </label>
      )}
    </>
  );
}
