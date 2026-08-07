#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/server-panel
ENV_DIR=/etc/server-panel

echo "[1/8] Benutzer & Verzeichnisse"
id server-panel >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin server-panel
mkdir -p "$ROOT/data" /var/log/server-panel "$ENV_DIR"
chown -R server-panel:server-panel "$ROOT" /var/log/server-panel

echo "[2/8] Dependencies installieren"
cd "$ROOT"
npm ci || npm install

echo "[3/8] Build"
npm run build

echo "[4/8] Privileged Helper"
install -m 0755 "$ROOT/backend/dist/helper/main.js" /usr/local/sbin/server-panel-helper
# Ensure node shebang wrapper
cat > /usr/local/sbin/server-panel-helper <<'EOF'
#!/usr/bin/env node
import('/opt/server-panel/backend/dist/helper/main.js')
EOF
# The helper module self-executes; use direct node invocation instead:
cat > /usr/local/sbin/server-panel-helper <<'EOF'
#!/bin/bash
exec /usr/bin/node /opt/server-panel/backend/dist/helper/main.js "$@"
EOF
chmod 0755 /usr/local/sbin/server-panel-helper
chown root:root /usr/local/sbin/server-panel-helper

echo "[5/8] sudoers"
install -m 0440 "$ROOT/deploy/sudoers/server-panel" /etc/sudoers.d/server-panel
visudo -cf /etc/sudoers.d/server-panel

echo "[6/8] Environment"
if [[ ! -f "$ENV_DIR/.env" ]]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  CSRF_SECRET=$(openssl rand -hex 32)
  ADMIN_PASS=$(openssl rand -base64 18)
  cat > "$ENV_DIR/.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=true
DATABASE_PATH=/opt/server-panel/data/panel.db
SESSION_SECRET=${SESSION_SECRET}
CSRF_SECRET=${CSRF_SECRET}
SESSION_MAX_AGE=28800
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
BOOTSTRAP_ADMIN_USER=admin
BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASS}
HELPER_PATH=/usr/local/sbin/server-panel-helper
PUBLIC_URL=https://server.codigoworks.net
FRONTEND_DIST=/opt/server-panel/frontend/dist
LOGIN_RATE_LIMIT_MAX=10
LOGIN_RATE_LIMIT_WINDOW_MS=900000
EOF
  chmod 640 "$ENV_DIR/.env"
  chown root:server-panel "$ENV_DIR/.env"
  echo "Admin-Passwort (einmalig): ${ADMIN_PASS}"
else
  echo "Environment existiert bereits: $ENV_DIR/.env"
fi

echo "[7/8] systemd"
install -m 0644 "$ROOT/deploy/systemd/server-panel.service" /etc/systemd/system/server-panel.service
systemctl daemon-reload
systemctl enable --now server-panel.service

echo "[8/8] nginx vorbereiten"
install -m 0644 "$ROOT/deploy/nginx/server.codigoworks.net.conf" /etc/nginx/sites-available/server.codigoworks.net.conf
ln -sfn /etc/nginx/sites-available/server.codigoworks.net.conf /etc/nginx/sites-enabled/server.codigoworks.net.conf
rm -f /etc/nginx/sites-enabled/default || true

echo "Fertig. Prüfe DNS für server.codigoworks.net und hole Zertifikat mit:"
echo "  certbot --nginx -d server.codigoworks.net"
