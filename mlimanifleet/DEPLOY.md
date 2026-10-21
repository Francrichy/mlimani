# MlimaniFleet — Deploy Guide (VPS & Docker)

## 1. Quick local / VPS (no Docker)

```bash
# On Ubuntu 22.04+
sudo apt update && sudo apt install -y nodejs npm git
git clone <your-repo> mlimanifleet && cd mlimanifleet
# Optional Postgres client libs if using DATABASE_URL:
# sudo apt install -y libpq-dev && npm install pg

export PORT=3847
export JWT_SECRET="$(openssl rand -hex 32)"
export PAYMENT_DEMO=false   # after you set gateway keys
export APP_URL=https://fleet.yourdomain.co.tz

node server/index.js
```

### Process manager (recommended)

```bash
sudo npm i -g pm2
pm2 start server/index.js --name mlimanifleet
pm2 save && pm2 startup
```

### Nginx reverse proxy + HTTPS

```nginx
server {
  listen 80;
  server_name fleet.yourdomain.co.tz;
  location / {
    proxy_pass http://127.0.0.1:3847;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d fleet.yourdomain.co.tz
```

---

## 2. Docker Compose

```bash
cd mlimanifleet
docker compose up -d --build
# App: http://YOUR_SERVER_IP:3847
```

To enable PostgreSQL: uncomment `db` service and `DATABASE_URL` in `docker-compose.yml`, then:

```bash
docker compose up -d --build
```

---

## 3. Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default 3847) |
| `JWT_SECRET` | Token signing key |
| `APP_URL` | Public URL for payment redirects/webhooks |
| `PAYMENT_DEMO` | `true` = simulate payments |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `SELCOM_VENDOR_ID` / `SELCOM_API_KEY` / `SELCOM_API_SECRET` | Selcom live |
| `PAWAPAY_API_TOKEN` / `PAWAPAY_ENV` | PawaPay (`sandbox` or `live`) |
| `NOTIFY_DEMO` | `true` = log SMS/WA only |
| `AT_USERNAME` / `AT_API_KEY` | Africa's Talking SMS |
| `TWILIO_*` | Twilio SMS alternative |
| `WA_ACCESS_TOKEN` / `WA_PHONE_NUMBER_ID` | WhatsApp Cloud API |

---

## 4. Webhooks

Point gateways to:

- Selcom: `https://fleet.yourdomain.co.tz/api/webhooks/selcom`
- PawaPay: `https://fleet.yourdomain.co.tz/api/webhooks/pawapay`

---

## 5. Daily subscription reminders

Cron (on the host or via pm2):

```bash
# Every day 08:00 EAT — admin token required; use internal script or curl with JWT
0 8 * * * curl -X POST http://127.0.0.1:3847/api/admin/reminders/run \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"channel":"sms","daysAhead":3}'
```

Or schedule with a small Node cron inside the process later.

---

## 6. Backups

- **JSON mode**: backup `./data/*.json` daily
- **Postgres**: `pg_dump $DATABASE_URL > backup.sql`

---

## 7. Go-live checklist

1. Set strong `JWT_SECRET`
2. Configure Selcom **or** PawaPay credentials; set `PAYMENT_DEMO=false`
3. Configure SMS (Africa's Talking recommended in TZ) or WhatsApp
4. HTTPS via Nginx + Certbot
5. Test payment with small amount on sandbox first
6. Run reminder job for 3-day advance notices
