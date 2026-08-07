import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Group = { name: string; gid: number; members: string[]; protected: boolean };

export function GroupsPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const manage = can('groups.manage');
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = async () => setGroups(await api<Group[]>('/api/groups'));
  useEffect(() => { void load().catch((e) => push(e.message, 'error')); }, [push]);

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/api/groups', { method: 'POST', json: { name } });
      setName('');
      push('Gruppe erstellt', 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    }
  }

  return (
    <>
      <div className="topbar">
        <div><h1>Gruppen</h1><p>Linux-Gruppenverwaltung</p></div>
      </div>

      {manage && (
        <form className="panel" style={{ marginBottom: '1rem' }} onSubmit={createGroup}>
          <div className="panel-header"><h2>Gruppe erstellen</h2></div>
          <div className="panel-body" style={{ display: 'flex', gap: '0.75rem' }}>
            <input className="input" placeholder="Gruppenname" value={name} onChange={(e) => setName(e.target.value)} required />
            <button className="btn primary">Erstellen</button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Gruppe</th><th>GID</th><th>Mitglieder</th><th>Aktionen</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <td className="mono">{g.name} {g.protected && <span className="badge muted">geschützt</span>}</td>
                  <td>{g.gid}</td>
                  <td style={{ whiteSpace: 'normal' }}>{g.members.join(', ') || '—'}</td>
                  <td>
                    {manage && !g.protected && (
                      <button className="btn danger" onClick={() => setConfirmDelete(g.name)}>Löschen</button>
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
        title="Gruppe löschen"
        message={confirmDelete ? `Gruppe "${confirmDelete}" wirklich löschen?` : ''}
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const g = confirmDelete!;
          setConfirmDelete(null);
          void (async () => {
            try {
              await api(`/api/groups/${g}`, { method: 'DELETE', json: { confirm: true } });
              push('Gruppe gelöscht', 'success');
              await load();
            } catch (err) {
              push(err instanceof Error ? err.message : 'Fehler', 'error');
            }
          })();
        }}
      />
    </>
  );
}
