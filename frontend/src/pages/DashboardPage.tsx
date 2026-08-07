import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type SystemInfo = {
  hostname: string;
  debianVersion: string;
  kernel: string;
  uptimeHuman: string;
  cpu: { cores: number; model: string; usagePercent: number };
  memory: { total: number; used: number; usagePercent: number };
  swap: { total: number; used: number; usagePercent: number };
  loadAverage: { '1m': number; '5m': number; '15m': number };
  processCount: number;
  time: { local: string };
  overview: {
    activeServices: number;
    failedServices: number;
    userCount: number;
    disks: Array<{ filesystem: string; size: string; used: string; avail: string; usePercent: number; mounted: string }>;
    recentEvents: string[];
  };
};

function fmtBytes(n: number) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function DashboardPage() {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const info = await api<SystemInfo>('/api/system');
        if (alive) {
          setData(info);
          setError('');
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Fehler');
      }
    };
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Dashboard</h1>
          <p>Live-Systemübersicht · Aktualisierung alle 5 Sekunden</p>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      {!data && !error && <div className="loading">Lade Systemdaten…</div>}
      {data && (
        <>
          <div className="grid" style={{ marginBottom: '1rem' }}>
            <div className="card"><h3>Hostname</h3><div className="value">{data.hostname}</div></div>
            <div className="card"><h3>Debian</h3><div className="value" style={{ fontSize: '1.05rem' }}>{data.debianVersion}</div></div>
            <div className="card"><h3>Kernel</h3><div className="value" style={{ fontSize: '1.05rem' }}>{data.kernel}</div></div>
            <div className="card"><h3>Uptime</h3><div className="value">{data.uptimeHuman}</div></div>
            <div className="card">
              <h3>CPU</h3>
              <div className="value">{data.cpu.usagePercent}%</div>
              <div className="progress"><span style={{ width: `${Math.min(data.cpu.usagePercent, 100)}%` }} /></div>
            </div>
            <div className="card">
              <h3>RAM</h3>
              <div className="value">{data.memory.usagePercent}%</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{fmtBytes(data.memory.used)} / {fmtBytes(data.memory.total)}</div>
              <div className="progress"><span style={{ width: `${Math.min(data.memory.usagePercent, 100)}%` }} /></div>
            </div>
            <div className="card">
              <h3>Swap</h3>
              <div className="value">{data.swap.usagePercent}%</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{fmtBytes(data.swap.used)} / {fmtBytes(data.swap.total)}</div>
            </div>
            <div className="card">
              <h3>Load Average</h3>
              <div className="value" style={{ fontSize: '1.1rem' }}>
                {data.loadAverage['1m'].toFixed(2)} / {data.loadAverage['5m'].toFixed(2)} / {data.loadAverage['15m'].toFixed(2)}
              </div>
            </div>
            <div className="card"><h3>Prozesse</h3><div className="value">{data.processCount}</div></div>
            <div className="card"><h3>Systemzeit</h3><div className="value" style={{ fontSize: '1.05rem' }}>{data.time.local}</div></div>
            <div className="card"><h3>Aktive Services</h3><div className="value">{data.overview.activeServices}</div></div>
            <div className="card"><h3>Fehlgeschlagene Services</h3><div className="value">{data.overview.failedServices}</div></div>
            <div className="card"><h3>Benutzer</h3><div className="value">{data.overview.userCount}</div></div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
            <div className="panel">
              <div className="panel-header"><h2>Festplatten</h2></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Filesystem</th><th>Size</th><th>Used</th><th>Free</th><th>Usage</th><th>Mount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overview.disks.map((d) => (
                      <tr key={d.mounted + d.filesystem}>
                        <td className="mono">{d.filesystem}</td>
                        <td>{d.size}</td>
                        <td>{d.used}</td>
                        <td>{d.avail}</td>
                        <td><span className={`badge ${d.usePercent >= 90 ? 'err' : d.usePercent >= 75 ? 'warn' : 'ok'}`}>{d.usePercent}%</span></td>
                        <td>{d.mounted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <div className="panel-header"><h2>Letzte Systemereignisse</h2></div>
              <div className="panel-body">
                <div className="log-view">{data.overview.recentEvents.join('\n') || 'Keine Einträge'}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
