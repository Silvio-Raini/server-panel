import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

type Audit = {
  rows: Array<{
    id: number;
    created_at: string;
    username: string | null;
    action: string;
    target: string | null;
    success: number;
    message: string | null;
    ip: string | null;
  }>;
  total: number;
};

export function AuditPage() {
  const { push } = useToast();
  const [data, setData] = useState<Audit | null>(null);
  useEffect(() => {
    void api<Audit>('/api/audit-log?limit=200').then(setData).catch((e) => push(e.message, 'error'));
  }, [push]);

  return (
    <>
      <div className="topbar"><div><h1>Audit Log</h1><p>Administrative Aktionen</p></div></div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Zeit</th><th>Benutzer</th><th>Aktion</th><th>Ziel</th><th>Status</th><th>IP</th><th>Meldung</th></tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.created_at}</td>
                  <td>{r.username || '—'}</td>
                  <td className="mono">{r.action}</td>
                  <td className="mono">{r.target || '—'}</td>
                  <td><span className={`badge ${r.success ? 'ok' : 'err'}`}>{r.success ? 'success' : 'error'}</span></td>
                  <td className="mono">{r.ip || '—'}</td>
                  <td style={{ whiteSpace: 'normal' }}>{r.message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
