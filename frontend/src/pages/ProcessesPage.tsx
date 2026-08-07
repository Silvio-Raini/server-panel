import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Proc = { pid: number; user: string; name: string; cpu: number; mem: number; start: string; command: string };

export function ProcessesPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const manage = can('processes.manage');
  const [sort, setSort] = useState<'cpu' | 'mem' | 'pid' | 'user'>('cpu');
  const [rows, setRows] = useState<Proc[]>([]);
  const [confirm, setConfirm] = useState<{ pid: number; signal: 'TERM' | 'KILL' } | null>(null);

  const load = async () => setRows(await api<Proc[]>(`/api/processes?sort=${sort}`));

  useEffect(() => {
    void load().catch((e) => push(e.message, 'error'));
    const id = setInterval(() => void load().catch(() => undefined), 8000);
    return () => clearInterval(id);
  }, [sort, push]);

  return (
    <>
      <div className="topbar">
        <div><h1>Prozesse</h1><p>Laufende Systemprozesse</p></div>
        <select className="select" style={{ maxWidth: 180 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="cpu">Sortierung: CPU</option>
          <option value="mem">Sortierung: RAM</option>
          <option value="pid">Sortierung: PID</option>
          <option value="user">Sortierung: Benutzer</option>
        </select>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>PID</th><th>User</th><th>Name</th><th>CPU</th><th>RAM</th><th>Start</th><th>Command</th><th></th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((p) => (
                <tr key={p.pid}>
                  <td className="mono">{p.pid}</td>
                  <td>{p.user}</td>
                  <td>{p.name}</td>
                  <td>{p.cpu.toFixed(1)}%</td>
                  <td>{p.mem.toFixed(1)}%</td>
                  <td>{p.start}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 360 }} className="mono">{p.command}</td>
                  <td>
                    {manage && (
                      <div className="btn-row">
                        <button className="btn" onClick={() => setConfirm({ pid: p.pid, signal: 'TERM' })}>TERM</button>
                        <button className="btn danger" onClick={() => setConfirm({ pid: p.pid, signal: 'KILL' })}>KILL</button>
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
        open={!!confirm}
        title="Prozess beenden"
        message={confirm ? `Prozess PID ${confirm.pid} mit SIG${confirm.signal} beenden?` : ''}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm!;
          setConfirm(null);
          void (async () => {
            try {
              await api(`/api/processes/${c.pid}/terminate`, { method: 'POST', json: { confirm: true, signal: c.signal } });
              push('Signal gesendet', 'success');
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
