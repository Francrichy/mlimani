# MlimaniFleet — SaaS Fleet ERP (Tanzania)

Trucks & **dala dala** fleet management with subscription billing, mobile money, and ops modules.

## Features

- Multi-tenant SaaS · Vehicles · Drivers · **Trips** · **Maintenance** · **Fuel**
- Recurring monthly plans (admin-editable pricing)
- **Selcom** & **PawaPay** mobile money (full HTTP + DEMO mode)
- **SMS / WhatsApp** invoice reminders (Africa's Talking, Twilio, Meta WA)
- **JSON** store by default · optional **PostgreSQL** via `DATABASE_URL`
- Docker + VPS deploy guide → see **[DEPLOY.md](DEPLOY.md)**

## Pricing (editable in Admin)

| Plan | Vehicles | TZS / month |
|------|----------|-------------|
| Starter | 1–5 | 10,000 |
| Growth | 6–10 | 20,000 |
| Business | 11–25 | 40,000 |
| Professional | 26–50 | 70,000 |
| Enterprise | 51+ | 120,000 |

## Run

```bash
node server/index.js
# http://localhost:3847
```

| Role | Email | Password |
|------|-------|----------|
| Fleet | demo@mlimanifleet.tz | demo123 |
| Admin | admin@mlimanifleet.tz | admin123 |

```bash
docker compose up -d --build
```

See `.env.example` and **DEPLOY.md** for production.


## Trial period
New companies get a **7-day free trial**.

## Logins (first seed)

| Role | Email | Password | Use |
|------|-------|----------|-----|
| **You (platform owner)** | `admin@mlimanifleet.tz` | `admin123` | Pricing, all companies |
| Demo fleet manager | `demo@mlimanifleet.tz` | `demo123` | Test only — remove on live |

**Production:** Change the admin password immediately. Remove or disable demo accounts. Set `SEED_DEMO=false` so demo is not recreated on empty DB.
