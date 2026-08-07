import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

type NetData = {
  publicIp: string | null;
  gateway: string | null;
  dns: string[];
  interfaces: Array<{
    name: string;
    ipv4: string[];
    ipv6: string[];
    mac: string | null;
    state: string;
    rxBytes: number;
    txBytes: number;
  }>;
  routes: Array<{ destination: string; gateway: string | null; device: string | null }>;
};

function fmt(n: number) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}

export function NetworkPage() {
  const { push } = useToast();
  const [data, setData] = useState<NetData | null>(null);
  useEffect(() => {
    void api<NetData>('/api/network').then(setData).catch((e) => push(e.message, 'error'));
  }, [push]);

  return (
    <>
      <div className="topbar"><div><h1>Netzwerk</h1><p>Interfaces, Routing und DNS</p></div></div>
      {!data && <div className="loading">Lade…</div>}
      {data && (
        <>
          <div className="grid" style={{ marginBottom: '1rem' }}>
            <div className="card"><h3>Öffentliche IP</h3><div className="value" style={{ fontSize: '1.1rem' }}>{data.publicIp || '—'}</div></div>
            <div className="card"><h3>Gateway</h3><div className="value" style={{ fontSize: '1.1rem' }}>{data.gateway || '—'}</div></div>
            <div className="card"><h3>DNS</h3><div className="value" style={{ fontSize: '1rem' }}>{data.dns.join(', ') || '—'}</div></div>
          </div>
          <div className="panel" style={{ marginBottom: '1rem' }}>
            <div className="panel-header"><h2>Interfaces</h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Status</th><th>IPv4</th><th>IPv6</th><th>MAC</th><th>RX</th><th>TX</th></tr></thead>
                <tbody>
                  {data.interfaces.map((i) => (
                    <tr key={i.name}>
                      <td className="mono">{i.name}</td>
                      <td><span className={`badge ${i.state === 'UP' ? 'ok' : 'muted'}`}>{i.state}</span></td>
                      <td className="mono">{i.ipv4.join(', ') || '—'}</td>
                      <td className="mono" style={{ whiteSpace: 'normal' }}>{i.ipv6.join(', ') || '—'}</td>
                      <td className="mono">{i.mac || '—'}</td>
                      <td>{fmt(i.rxBytes)}</td>
                      <td>{fmt(i.txBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><h2>Routing</h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Destination</th><th>Gateway</th><th>Device</th></tr></thead>
                <tbody>
                  {data.routes.map((r, idx) => (
                    <tr key={idx}>
                      <td className="mono">{r.destination}</td>
                      <td className="mono">{r.gateway || '—'}</td>
                      <td>{r.device || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
