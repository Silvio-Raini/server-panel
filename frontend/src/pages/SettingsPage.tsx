import { useState, type FormEvent } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

export function SettingsPage() {
  const { push } = useToast();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        json: { currentPassword, newPassword },
      });
      push('Passwort geändert', 'success');
      setCurrent('');
      setNew('');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Fehler', 'error');
    }
  }

  return (
    <>
      <div className="topbar">
        <div><h1>Einstellungen</h1><p>Konto & Sicherheit · 2FA vorbereitet</p></div>
      </div>
      <form className="panel" style={{ maxWidth: 480 }} onSubmit={onSubmit}>
        <div className="panel-header"><h2>Passwort ändern</h2></div>
        <div className="panel-body">
          <div className="field">
            <label className="label">Aktuelles Passwort</label>
            <input className="input" type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label">Neues Passwort</label>
            <input className="input" type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} required minLength={8} />
          </div>
          <button className="btn primary">Speichern</button>
          <p style={{ color: 'var(--muted)', marginTop: '1rem', fontSize: '0.9rem' }}>
            TOTP/2FA kann später ergänzt werden. Die Benutzerdatenbank enthält bereits die Felder <code>totp_secret</code> und <code>totp_enabled</code>.
          </p>
        </div>
      </form>
    </>
  );
}
