# MlimaniFleet — Launch checklist

## 1. PostgreSQL (required for real clients)

### On Render
1. Dashboard → **New** → **PostgreSQL**
2. Create database (same region as the web service)
3. Copy **Internal Database URL** (or External if needed)
4. Web service → **Environment** → add:

```
DATABASE_URL=<paste Internal Database URL>
PGSSL=true
JWT_SECRET=<long random string>
APP_URL=https://mlimani.onrender.com
PAYMENT_DEMO=false
SEED_DEMO=false
```

5. **Build command:** `npm install`
6. **Start command:** `node server/index.js`
7. Redeploy

After deploy, logs should show: `DB: PostgreSQL ready`

Without `DATABASE_URL`, data is only on disk and **can reset** on redeploy.

## 2. Environment variables (production)

| Variable | Required | Example |
|----------|----------|---------|
| `DATABASE_URL` | Yes for launch | from Render Postgres |
| `JWT_SECRET` | Yes | random 32+ chars |
| `APP_URL` | Yes | https://mlimani.onrender.com or https://app.mlimani.net |
| `PAYMENT_DEMO` | Yes live | `false` |
| `PAWAPAY_API_TOKEN` | If using PawaPay | from PawaPay |
| `PAWAPAY_ENV` | If live | `live` or `sandbox` |
| `SEED_DEMO` | Recommended | `false` |

## 3. Before clients pay

- [ ] Postgres connected (check logs)
- [ ] Login works after **second** redeploy (data still there)
- [ ] Change admin password
- [ ] Set `SEED_DEMO=false`
- [ ] PawaPay callback: `https://YOUR-DOMAIN/api/webhooks/pawapay`
- [ ] Custom domain optional: app.mlimani.net → same service
- [ ] Marketing site: mlimani.net (Netlify landing)

## 4. Updates after launch

1. Push code to GitHub  
2. Render redeploys automatically  
3. **Client data stays in Postgres** — not wiped  

## 5. Owner login

- Email: `admin@mlimanifleet.tz`  
- Password: change from default `admin123` immediately  

## 6. Smoke test

1. Register a new company (mobile + password)  
2. Add 1 vehicle, 1 receive in warehouse  
3. Redeploy once  
4. Confirm vehicle + stock still exist  
