import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Service = {
  name: string;
  description: string;
  activeState: string;
  subState: string;
  unitFileState: string;
  enabled: boolean;
  running: boolean;
  mainPid: number | null;
  activeEnterTimestamp: string | null;
};

type ConfirmState = { op: 'stop' | 'restart' | 'disable'; name: string } | null;

export function ServicesPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [detail, setDetail] = useState('');
  const manage = can('services.manage');

  const load = async () => {
    setServices(await api<Service[]>('/api/services'));
  };

  useEffect(() => {
    void load().catch((e) => push(e.message, 'error'));
  }, [push]);

  const filtered = useMemo(
    () => services.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase())),
    [services, q],
  );

  async function run(op: string, name: string, needsConfirm = false) {
    if (needsConfirm) {
      setConfirm({ op: op as ConfirmState extends null ? never : NonNullable<ConfirmState>['op'], name });
      return;
    }
    setBusy(`${op}:${name}`);
    try {
      await api(`/api/services/${encodeURIComponent(name)}/${op}`, {
        method: 'POST',
        json: { confirm: true },
      });
      push(`Service ${name}: ${op}`, 'success');
      await load();
    } catch (e) {
      push(e instanceof Error ? e.message : 'Fehler', 'error');
    } finally {
      setBusy('');
    }
  }

  async function showStatus(name: string) {
    try {
      const data = await api<{ text: string }>(`/api/services/${encodeURIComponent(name)}/status`);
      setDetail(data.text);
    } catch (e) {
      push(e instanceof Error ? e.message : 'Fehler', 'error');
    }
  }

  async function showLogs(name: string) {
    try {
      const data = await api<{ lines: string[] }>(`/api/services/${encodeURIComponent(name)}/logs?lines=80`);
      setDetail(data.lines.join('\n'));
    } catch (e) {
      push(e instanceof Error ? e.message : 'Fehler', 'error');
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Services</h1>
          <p>systemd-Serviceverwaltung</p>
        </div>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th><th>Status</th><th>Enabled</th><th>PID</th><th>Letzter Start</th><th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.name}>
                  <td>
                    <div className="mono">{s.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{s.description}</div>
                  </td>
                  <td>
                    <span className={`badge ${s.running ? 'ok' : s.activeState === 'failed' ? 'err' : 'muted'}`}>
                      {s.activeState}/{s.subState}
                    </span>
                  </td>
                  <td><span className={`badge ${s.enabled ? 'ok' : 'muted'}`}>{s.unitFileState}</span></td>
                  <td className="mono">{s.mainPid ?? '—'}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 180 }}>{s.activeEnterTimestamp ?? '—'}</td>
                  <td>
                    <div className="btn-row">
                      {manage && !s.running && <button className="btn" disabled={!!busy} onClick={() => void run('start', s.name)}>Start</button>}
                      {manage && s.running && <button className="btn" disabled={!!busy} onClick={() => void run('stop', s.name, true)}>Stop</button>}
                      {manage && <button className="btn" disabled={!!busy} onClick={() => void run('restart', s.name, true)}>Restart</button>}
                      {manage && <button className="btn" disabled={!!busy} onClick={() => void run('reload', s.name)}>Reload</button>}
                      {manage && <button className="btn" disabled={!!busy} onClick={() => void run('enable', s.name)}>Enable</button>}
                      {manage && <button className="btn" disabled={!!busy} onClick={() => void run('disable', s.name, true)}>Disable</button>}
                      <button className="btn ghost" onClick={() => void showStatus(s.name)}>Status</button>
                      <button className="btn ghost" onClick={() => void showLogs(s.name)}>Logs</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <div className="panel-header">
            <h2>Details</h2>
            <button className="btn ghost" onClick={() => setDetail('')}>Schließen</button>
          </div>
          <div className="panel-body"><div className="log-view">{detail}</div></div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Aktion bestätigen"
        message={confirm ? `Möchtest du den Service \`${confirm.name}\` wirklich ${confirm.op === 'restart' ? 'neu starten' : confirm.op === 'stop' ? 'stoppen' : 'deaktivieren'}?` : ''}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { op, name } = confirm;
          setConfirm(null);
          void run(op, name);
        }}
      />
    </>
  );
}
