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

```bash
docker compose up -d --build
```

See `.env.example` and **DEPLOY.md** for production.


## Trial period
New companies get a **7-day free trial**.

## Secure first-time setup

A fresh database does not receive public demo accounts. Configure these private environment variables on the hosting provider before the first startup:

- `JWT_SECRET`: a randomly generated secret of at least 32 characters.
- `BOOTSTRAP_ADMIN_EMAIL`: the email address for the first platform owner.
- `BOOTSTRAP_ADMIN_PASSWORD`: a unique password of at least 12 characters.

The first platform-owner account is created only when the users collection is empty. Existing user accounts are not replaced by this process. Never commit real secrets or passwords to the repository.
