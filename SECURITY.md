# Sicherheitskonzept – Server Panel

## Bedrohungsmodell

Das Panel verwaltet privilegierte Serverfunktionen. Angreiferziele sind insbesondere:

- Übernahme von Admin-Sessions
- Command Injection über Service-/Benutzernamen
- Privilege Escalation vom Webprozess zu root
- Brute-Force gegen Login
- CSRF auf mutierende Aktionen

## Architekturprinzipien

1. **Keine beliebige Shell-Ausführung**  
   Es gibt keine API wie `/api/execute` oder `/api/shell`.

2. **Allowlist + Validierung**  
   Service-, Benutzer-, Gruppen- und PID-Parameter werden serverseitig mit strengen Regex-Regeln geprüft.

3. **Getrennte Privilegien**  
   - Webbackend läuft als unprivilegierter Benutzer `server-panel`
   - Privilegien nur über `/usr/local/sbin/server-panel-helper`
   - sudoers erlaubt ausschließlich diesen Helper

4. **Helper ohne Shell**  
   Der Helper startet feste Binaries (`systemctl`, `useradd`, …) mit `spawn` und Argument-Arrays.

5. **AuthN/AuthZ**  
   - Argon2id Passwort-Hashes
   - Session-Cookies: `HttpOnly`, `Secure`, `SameSite`
   - CSRF-Token für mutierende Requests (`X-CSRF-Token`)
   - RBAC (`admin`, `readonly`) serverseitig enforced
   - Rate Limiting auf Login

6. **Audit Logging**  
   Administrative Aktionen werden mit Benutzer, Aktion, Ziel, Erfolg/Fehler und IP protokolliert.

7. **Fehlerausgaben**  
   API liefert nur öffentliche Fehlercodes/Nachrichten. Stacktraces bleiben im Serverlog.

8. **Transport**  
   Betrieb hinter nginx mit HTTPS. Backend lauscht nur auf `127.0.0.1:3000`.

## Geschützte Ressourcen

- Kritische Services (`ssh`, `nginx`, `server-panel`, …) dürfen nicht gestoppt/deaktiviert werden
- Systembenutzer und -gruppen sind gegen Löschen/Sperren geschützt
- PID 1 und der Panel-eigene Prozess sind geschützt

## 2FA-Vorbereitung

Die Benutzerdatenbank enthält `totp_secret` und `totp_enabled`. Login kann später um einen zweiten Schritt erweitert werden, ohne Session-/Rollenmodell zu ändern.

## Empfohlene Betriebsmaßnahmen

- Bootstrap-Adminpasswort sofort ändern
- Fail2ban für SSH und ggf. nginx Auth-Routen aktiv halten
- Regelmäßige Backups von `/opt/server-panel/data/panel.db` und `/etc/server-panel/.env`
- DNS und Zertifikate aktuell halten
- Updates für Debian und Node.js einspielen
