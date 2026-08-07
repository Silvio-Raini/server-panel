import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

export function LogsPage() {
  const { push } = useToast();
  const [unit, setUnit] = useState('');
  const [since, setSince] = useState('1 hour ago');
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(false);

  const load = async () => {
    const qs = new URLSearchParams({ lines: '150', since });
    if (unit.trim()) qs.set('unit', unit.trim().endsWith('.service') ? unit.trim() : `${unit.trim()}.service`);
    const data = await api<{ lines: string[]; truncated: boolean }>(`/api/logs?${qs}`);
    setLines(data.lines);
  };

  useEffect(() => {
    void load().catch((e) => push(e.message, 'error'));
  }, []);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void load().catch(() => undefined), 4000);
    return () => clearInterval(id);
  }, [live, unit, since]);

  return (
    <>
      <div className="topbar">
        <div><h1>Logs</h1><p>systemd-Journal</p></div>
      </div>
      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto auto', gap: '0.75rem' }}>
          <input className="input" placeholder="Service (optional, z.B. nginx)" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <input className="input" placeholder="Since" value={since} onChange={(e) => setSince(e.target.value)} />
          <button className="btn primary" onClick={() => void load().catch((e) => push(e.message, 'error'))}>Laden</button>
          <button className={`btn ${live ? 'primary' : ''}`} onClick={() => setLive((v) => !v)}>{live ? 'Live an' : 'Live aus'}</button>
        </div>
      </div>
      <div className="log-view">{lines.join('\n') || 'Keine Logeinträge'}</div>
    </>
  );
}
