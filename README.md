# CodigoWorks Server Panel

Modernes, webbasiertes Server-Management-Panel für **Debian 13**.

Öffentliche URL: `https://server.codigoworks.net`

## Tech-Stack

| Schicht | Technologie |
|--------|-------------|
| Frontend | React 19, TypeScript, Vite, CSS (Dark UI) |
| Backend | Node.js 22, Fastify, TypeScript |
| Datenbank | SQLite (`better-sqlite3`), austauschbar Richtung PostgreSQL |
| Auth | Sessions + Argon2id + CSRF + Rate Limit |
| Privilegien | dedizierter Helper via restriktives sudo |
| Proxy | nginx + Let's Encrypt |

## Architektur

```text
Browser
  ↓ HTTPS
nginx (server.codigoworks.net)
  ↓ proxy_pass
Backend API (127.0.0.1:3000, User: server-panel)
  ↓ validierte Aktionen
sudo → /usr/local/sbin/server-panel-helper (root)
  ↓
Debian-System (systemctl, useradd, journalctl, …)
```

### systemd-Kommunikation

- Lesen: `systemctl show/list-units/status`, `journalctl` über `spawn` ohne Shell
- Schreiben: Helper-Aktionen `service start|stop|restart|reload|enable|disable`

### Authentifizierung & Rollen

- **admin**: lesen + verwalten (Services, User, Groups, Prozesse, …)
- **readonly**: nur lesen
- Berechtigungen werden ausschließlich serverseitig geprüft
- 2FA/TOTP ist datenbankseitig vorbereitet

## Projektstruktur

```text
/opt/server-panel
├── backend/          Fastify API + Systemservices + Helper
├── frontend/         React SPA
├── deploy/           nginx, systemd, sudoers
├── scripts/          Installationsskripte
├── tests/            Vitest-Tests
├── data/             SQLite DB (runtime)
├── README.md
└── SECURITY.md
```

## Lokale Entwicklung

```bash
cp .env.example .env
# Secrets setzen, COOKIE_SECURE=false für http://127.0.0.1
npm install
npm run dev
```

- API: `http://127.0.0.1:3000`
- Vite Dev: `http://127.0.0.1:5173` (proxied `/api`)

## Installation auf Debian 13

### Benötigte Pakete

```bash
apt-get install -y nginx certbot python3-certbot-nginx git curl
# Node.js 22 (Nodesource oder Distribution)
```

### Deploy

```bash
cd /opt/server-panel
bash scripts/install.sh
```

Das Skript:

1. legt User `server-panel` an
2. baut Frontend/Backend
3. installiert Helper + sudoers
4. schreibt `/etc/server-panel/.env`
5. aktiviert `server-panel.service`
6. bereitet nginx vor

### HTTPS / Reverse Proxy

1. DNS `server.codigoworks.net` → Server-IP
2. Zertifikat:

```bash
certbot --nginx -d server.codigoworks.net
systemctl reload nginx
```

Konfiguration: `deploy/nginx/server.codigoworks.net.conf`

## Environment-Variablen

Siehe `.env.example`. Produktionsdatei: `/etc/server-panel/.env`

Wichtige Keys:

- `SESSION_SECRET`, `CSRF_SECRET`
- `BOOTSTRAP_ADMIN_USER`, `BOOTSTRAP_ADMIN_PASSWORD` (nur Erststart)
- `HELPER_PATH`
- `DATABASE_PATH`

## Berechtigungen / sudo

Datei: `/etc/sudoers.d/server-panel`

```text
server-panel ALL=(root) NOPASSWD: /usr/local/sbin/server-panel-helper
```

Der Helper akzeptiert ausschließlich validiertes JSON und startet feste Systembinaries.

## systemd-Service

```bash
systemctl status server-panel
journalctl -u server-panel -f
```

Unit: `deploy/systemd/server-panel.service`

## Backup / Restore

```bash
# Backup
cp /opt/server-panel/data/panel.db /root/backup-panel-$(date +%F).db
cp /etc/server-panel/.env /root/backup-panel.env

# Restore
systemctl stop server-panel
cp /root/backup-panel-YYYY-MM-DD.db /opt/server-panel/data/panel.db
chown server-panel:server-panel /opt/server-panel/data/panel.db
systemctl start server-panel
```

## File Manager

Unter **Files** im Panel:

- gesamtes Dateisystem ab `/`
- Ordner browsen, Dateien ansehen/bearbeiten/speichern
- Dateien & Ordner erstellen, umbenennen, löschen
- Shortcuts: `/`, `/var/www`, `/etc`, `/var/log`, …
- Schreiben/Löschen nur für Rolle `admin` (`files.manage`)
- Audit-Log für alle Mutationen
- geschützt vor Löschung: `/`, `/etc`, `/usr`, `/var`, … (System-Mountpoints)
- kein Schreiben in `/proc`, `/sys`, `/dev`

Der Domain-Document-Root-Picker bleibt auf Webroots beschränkt.

## SFTP-Accounts

Unter **SFTP** im Panel:

- dynamische Accounts (`sftp_name`)
- Chroot unter `/var/sftp/<user>`
- schreibbares Verzeichnis: `/data` (im Chroot)
- Berechtigungen: **RW** oder **RO** (`internal-sftp -R`)
- kein Shell-Login (`nologin`), kein Forwarding
- sperren/entsperren, Passwort setzen, löschen inkl. optionaler Datenlöschung

sshd Drop-in: `/etc/ssh/sshd_config.d/60-server-panel-sftp.conf`

## Domains / SSL

Unter **Domains** im Panel können Domains verbunden werden:

| Typ | Ziel | Beispiel |
|-----|------|----------|
| `proxy` | lokaler Port / App | `8080` oder `127.0.0.1:3001` |
| `static` | Document-Root | `/var/www/meine-seite` |
| `redirect` | externe URL | `https://example.com` |

Ablauf:

1. nginx-VHost wird unter `/etc/nginx/sites-available/sp-<domain>.conf` erzeugt
2. Site wird aktiviert, `nginx -t` + Reload
3. optional sofort Certbot (`certbot --nginx`) für Let's Encrypt

Erlaubte Document-Roots: `/var/www`, `/opt/sites`, `/srv/www`  
Geschützt: `server.codigoworks.net` (Panel selbst)

Vor SSL muss die Domain per DNS auf diesen Server zeigen. Kontaktmail: `CERTBOT_EMAIL`.

## API (Auszug)

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/system
GET    /api/services
POST   /api/services/:name/restart

GET    /api/domains
POST   /api/domains
PUT    /api/domains/:id
DELETE /api/domains/:id
POST   /api/domains/:id/ssl
POST   /api/domains/:id/reapply

GET    /api/users
POST   /api/users
DELETE /api/users/:username

GET    /api/groups
GET    /api/processes
GET    /api/logs
GET    /api/storage
GET    /api/network
GET    /api/audit-log
```

Alle mutierenden Endpoints verlangen Session + CSRF + passende Permission.

## Tests

```bash
npm test
```

Abgedeckt u. a.: Eingabevalidierung (Injection), Berechtigungen admin/readonly.

## Module später ergänzen

Docker, Firewall, Backups, Paketverwaltung, Monitoring, Terminal, 2FA-UI usw.  
Neue Module als `backend/src/services/<modul>` + `backend/src/api/<modul>` + Frontend-Seite einhängen.

## Security

Siehe [SECURITY.md](./SECURITY.md).
