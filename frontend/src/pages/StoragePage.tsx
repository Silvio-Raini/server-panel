import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

type Mount = {
  filesystem: string;
  type: string;
  size: string;
  used: string;
  free: string;
  usagePercent: number;
  mount: string;
};

export function StoragePage() {
  const { push } = useToast();
  const [rows, setRows] = useState<Mount[]>([]);
  useEffect(() => {
    void api<Mount[]>('/api/storage').then(setRows).catch((e) => push(e.message, 'error'));
  }, [push]);

  return (
    <>
      <div className="topbar"><div><h1>Speicher</h1><p>Mountpoints und Auslastung</p></div></div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Filesystem</th><th>Type</th><th>Size</th><th>Used</th><th>Free</th><th>Usage</th><th>Mount</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.mount + r.filesystem}>
                  <td className="mono">{r.filesystem}</td>
                  <td>{r.type}</td>
                  <td>{r.size}</td>
                  <td>{r.used}</td>
                  <td>{r.free}</td>
                  <td>
                    <span className={`badge ${r.usagePercent >= 90 ? 'err' : r.usagePercent >= 75 ? 'warn' : 'ok'}`}>{r.usagePercent}%</span>
                    <div className="progress"><span style={{ width: `${Math.min(r.usagePercent, 100)}%` }} /></div>
                  </td>
                  <td>{r.mount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
