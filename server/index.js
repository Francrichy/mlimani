/**
 * MlimaniFleet — Complete SaaS Fleet ERP Server
 * Zero external dependencies (Node.js built-ins only)
 * Port: 3847
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { read, write, uid, now } = require('./db');
const { hashPassword, verifyPassword, createToken, verifyToken } = require('./auth');
const { selcomCreateOrder, pawapayDeposit, selcomQueryOrder, pawapayDepositStatus, TZA_PROVIDERS, DEMO } = require('./payments');
const { getPricingTiers, priceForCount } = require('./pricing');
const mod = require('./modules');
const notify = require('./notifications');
const { initPg } = require('./pg');
const fin = require('./finance');
const gps = require('./gps');
const team = require('./team');
const inv = require('./inventory');
const exp = require('./expenses');
const mrules = require('./maint_rules');

const PORT = process.env.PORT || 3847;
const PUBLIC = path.join(__dirname, '..', 'public');

// ---------- Helpers ----------
function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

function getAuth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return verifyToken(token);
}

function requireAuth(req, res) {
  const user = getAuth(req);
  if (!user) {
    send(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'platform_admin') {
    send(res, 403, { error: 'Admin only' });
    return null;
  }
  return user;
}

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(full);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// Pricing: see server/pricing.js



// ---------- Seed on first run ----------
function seedIfEmpty() {
  const users = read('users');
  if (users.length) return;

  const adminId = uid();
  const companyId = uid();

  write('users', [{
    id: adminId,
    email: 'admin@mlimanifleet.tz',
    password: hashPassword('admin123'),
    name: 'Platform Admin',
    role: 'platform_admin',
    company_id: null,
    created_at: now()
  }, {
    id: uid(),
    email: 'demo@mlimanifleet.tz',
    password: hashPassword('demo123'),
    name: 'Juma Mwangi',
    role: 'fleet_manager',
    company_id: companyId,
    permissions: team.ROLE_PRESETS.fleet_manager.permissions,
    active: true,
    created_at: now()
  }]);

  write('companies', [{
    id: companyId,
    name: 'Demo Transport Ltd',
    phone: '255712345678',
    email: 'demo@mlimanifleet.tz',
    subscription_status: 'active',
    tin: '',
    vrn: '',
    address: 'Dar es Salaam, Tanzania',
    city: 'Dar es Salaam',
    vat_default: false,
    invoice_footer: 'Thank you for your business',

    vehicle_limit: 10,
    current_vehicles: 3,
    next_billing_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    created_at: now()
  }]);

  write('vehicles', [
    { id: uid(), company_id: companyId, plate: 'T 234 ABC', type: 'truck', make: 'Isuzu', model: 'FVR', year: 2019, status: 'on_route', odometer: 142800, driver_id: null, created_at: now() },
    { id: uid(), company_id: companyId, plate: 'T 891 KLM', type: 'daladala', make: 'Toyota', model: 'Coaster', year: 2018, status: 'on_route', odometer: 89200, driver_id: null, created_at: now() },
    { id: uid(), company_id: companyId, plate: 'T 456 XYZ', type: 'truck', make: 'Scania', model: 'R450', year: 2021, status: 'workshop', odometer: 67800, driver_id: null, created_at: now() }
  ]);

  write('drivers', [
    { id: uid(), company_id: companyId, name: 'Hassan Juma', phone: '255754111222', license_no: 'DL-88291', license_expiry: '2027-06-15', status: 'active', created_at: now() },
    { id: uid(), company_id: companyId, name: 'Amina Said', phone: '255713333444', license_no: 'DL-44102', license_expiry: '2026-10-28', status: 'active', created_at: now() }
  ]);

  write('subscriptions', []);
  write('payments', []);
  write('pricing_tiers', []); // will auto-seed on first get
  getPricingTiers();

  console.log('✓ Seeded demo data');
  console.log('  Owner (platform admin) — see seed credentials in README');
  if (process.env.SEED_DEMO !== 'false') console.log('  Demo: demo@mlimanifleet.tz / demo123');
}


function activatePaymentByRef(ref) {
  if (!ref) return false;
  const payments = read('payments') || [];
  const idx = payments.findIndex(p =>
    p.id === ref || p.gateway_ref === ref ||
    (p.gateway_response && (p.gateway_response.depositId === ref || p.gateway_response.reference === ref))
  );
  if (idx < 0) {
    console.log('Payment not found for ref', ref);
    return false;
  }
  if (payments[idx].status === 'completed') return true;
  payments[idx].status = 'completed';
  payments[idx].completed_at = now();
  write('payments', payments);

  const companyId = payments[idx].company_id;
  const companies = read('companies') || [];
  const ci = companies.findIndex(c => c.id === companyId);
  if (ci >= 0) {
    companies[ci].subscription_status = 'active';
    companies[ci].next_billing_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    if (payments[idx].vehicle_count) {
      // keep limit in line with paid tier when available
    }
    write('companies', companies);
    console.log('Subscription activated for company', companyId);
  }
  return true;
}


// ---------- Router ----------
async function handleApi(req, res, pathname) {
  const method = req.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await parseBody(req) : {};

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    });
    return res.end();
  }

  // ---- AUTH ----
  if (pathname === '/api/auth/register' && method === 'POST') {
    const { email, password, name, company_name, phone } = body;
    if (!email || !password || !company_name) return send(res, 400, { error: 'email, password, company_name required' });
    const users = read('users');
    if (users.find(u => u.email === email.toLowerCase())) return send(res, 409, { error: 'Email already registered' });

    const companyId = uid();
    const userId = uid();
    const companies = read('companies');
    companies.push({
      id: companyId,
      name: company_name,
      phone: phone || '',
      email: email.toLowerCase(),
      subscription_status: 'trial',
      vehicle_limit: 5,
      current_vehicles: 0,
      next_billing_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      trial_ends: new Date(Date.now() + 7 * 86400000).toISOString(),
      created_at: now()
    });
    write('companies', companies);

    users.push({
      id: userId,
      email: email.toLowerCase(),
      password: hashPassword(password),
      name: name || company_name,
      role: 'fleet_manager',
      company_id: companyId,
      permissions: team.ROLE_PRESETS.fleet_manager.permissions,
      active: true,
      created_at: now()
    });
    write('users', users);

    const token = createToken({ id: userId, email: email.toLowerCase(), role: 'fleet_manager', company_id: companyId });
    return send(res, 201, { token, user: { id: userId, email, name, role: 'fleet_manager', company_id: companyId } });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const { email, password } = body;
    const users = read('users');
    const user = users.find(u => u.email === (email || '').toLowerCase());
    if (!user || !verifyPassword(password || '', user.password)) {
      return send(res, 401, { error: 'Invalid email or password' });
    }
    const token = createToken({ id: user.id, email: user.email, role: user.role, company_id: user.company_id });
    return send(res, 200, {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, company_id: user.company_id, permissions: user.permissions || null }
    });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const users = read('users');
    const user = users.find(u => u.id === auth.id);
    if (!user) return send(res, 404, { error: 'User not found' });
    let company = null;
    if (user.company_id) {
      company = read('companies').find(c => c.id === user.company_id) || null;
    }
    return send(res, 200, {
      user: { id: user.id, email: user.email, name: user.name, role: user.role, company_id: user.company_id, permissions: user.permissions || null },
      company
    });
  }

  // ---- PRICING (public) ----
  if (pathname === '/api/pricing' && method === 'GET') {
    return send(res, 200, { tiers: getPricingTiers(), currency: 'TZS' });
  }

  // ---- ADMIN: Pricing ----
  if (pathname === '/api/admin/pricing' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, { tiers: read('pricing_tiers') });
  }

  if (pathname === '/api/admin/pricing' && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    const { tiers } = body;
    if (!Array.isArray(tiers)) return send(res, 400, { error: 'tiers array required' });
    write('pricing_tiers', tiers);
    return send(res, 200, { ok: true, tiers });
  }

  // ---- ADMIN: Companies ----
  if (pathname === '/api/admin/companies' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const companies = read('companies');
    const vehicles = read('vehicles');
    const enriched = companies.map(c => ({
      ...c,
      vehicle_count: vehicles.filter(v => v.company_id === c.id).length
    }));
    return send(res, 200, { companies: enriched });
  }

  // ---- COMPANY / BILLING ----
  
  // ---------- Company profile (TIN, address for invoices) ----------
  if (pathname === '/api/company/profile' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!auth.company_id) return send(res, 400, { error: 'No company' });
    const c = read('companies').find(x => x.id === auth.company_id);
    if (!c) return send(res, 404, { error: 'Company not found' });
    return send(res, 200, { company: c });
  }
  if (pathname === '/api/company/profile' && method === 'PUT') {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!auth.company_id) return send(res, 400, { error: 'No company' });
    if (auth.role !== 'fleet_manager' && auth.role !== 'platform_admin' && !(auth.permissions && auth.permissions.billing)) {
      return send(res, 403, { error: 'No permission' });
    }
    const all = read('companies');
    const i = all.findIndex(x => x.id === auth.company_id);
    if (i < 0) return send(res, 404, { error: 'Not found' });
    const fields = ['name','phone','email','address','city','tin','vrn','vat_default','invoice_footer'];
    for (const f of fields) if (body[f] !== undefined) all[i][f] = body[f];
    write('companies', all);
    return send(res, 200, { company: all[i] });
  }

if (pathname === '/api/billing/summary' && method === 'GET') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (auth.role === 'platform_admin') return send(res, 403, { error: 'Platform admin does not use company subscription plans' });
    if (!auth.company_id) return send(res, 400, { error: 'No company' });
    const company = read('companies').find(c => c.id === auth.company_id);
    const vehicles = read('vehicles').filter(v => v.company_id === auth.company_id);
    const count = vehicles.length;
    const { tier, amount } = priceForCount(Math.max(count, 1));
    const payments = read('payments').filter(p => p.company_id === auth.company_id).slice(-10).reverse();
    return send(res, 200, {
      company,
      vehicle_count: count,
      current_tier: tier,
      monthly_amount: amount,
      payments,
      providers: TZA_PROVIDERS
    });
  }

  if (pathname === '/api/billing/pay' && method === 'POST') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (auth.role === 'platform_admin') return send(res, 403, { error: 'Platform admin does not use company subscription plans' });
    if (!auth.company_id) return send(res, 400, { error: 'No company' });
    const { phone, gateway, provider } = body;
    if (!phone) return send(res, 400, { error: 'phone required' });

    const company = read('companies').find(c => c.id === auth.company_id);
    const vehicles = read('vehicles').filter(v => v.company_id === auth.company_id);
    const count = Math.max(vehicles.length, 1);
    const { tier, amount } = priceForCount(count);
    if (!amount) return send(res, 400, { error: 'Could not calculate price' });

    const orderId = uid();
    const payment = {
      id: orderId,
      company_id: auth.company_id,
      amount,
      currency: 'TZS',
      phone,
      gateway: gateway || 'selcom',
      provider: provider || null,
      status: 'pending',
      tier_id: tier?.id,
      vehicle_count: count,
      created_at: now()
    };

    let result;
    try {
      if ((gateway || 'selcom') === 'pawapay') {
        result = await pawapayDeposit({
          amount,
          phone: phone.replace(/^0/, '255'),
          provider: provider || 'VODACOM_TZA',
          depositId: orderId,
          message: `MlimaniFleet ${tier?.name || ''} subscription`
        });
      } else {
        result = await selcomCreateOrder({
          amount,
          phone,
          name: company?.name,
          email: company?.email,
          orderId,
          webhookUrl: (process.env.APP_URL || 'http://localhost:3847') + '/api/webhooks/selcom'
        });
      }
    } catch (e) {
      return send(res, 502, { error: e.message });
    }

    payment.gateway_ref = result.reference || result.depositId || orderId;
    payment.gateway_response = result;

    // DEMO: auto-complete
    if (DEMO && result.success) {
      payment.status = 'completed';
      payment.completed_at = now();
      // extend subscription
      const companies = read('companies');
      const idx = companies.findIndex(c => c.id === auth.company_id);
      if (idx >= 0) {
        companies[idx].subscription_status = 'active';
        companies[idx].vehicle_limit = tier.max_vehicles;
        companies[idx].next_billing_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        write('companies', companies);
      }
    }

    const payments = read('payments');
    payments.push(payment);
    write('payments', payments);

    return send(res, 200, {
      payment,
      message: DEMO
        ? 'DEMO payment completed successfully. Subscription activated for 30 days.'
        : 'Payment initiated. Confirm on your phone.'
    });
  }

  // Payment webhooks
  if (pathname === '/api/webhooks/selcom' && method === 'POST') {
    console.log('Selcom webhook', body);
    // Activate if order completed
    const orderId = body.order_id || body.transid || body.reference;
    const status = String(body.payment_status || body.result || body.status || '').toUpperCase();
    if (orderId && (status.includes('COMPLETE') || status.includes('SUCCESS') || status === 'PAID')) {
      activatePaymentByRef(orderId);
    }
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/webhooks/pawapay' && method === 'POST') {
    console.log('PawaPay webhook', JSON.stringify(body).slice(0, 500));
    // PawaPay deposit callback shapes vary; common fields:
    const depositId = body.depositId || body.deposit_id || (body.data && body.data.depositId);
    const status = String(body.status || (body.data && body.data.status) || '').toUpperCase();
    if (depositId && (status === 'COMPLETED' || status === 'SUCCESS' || status === 'SUCCESSFUL')) {
      activatePaymentByRef(depositId);
    }
    return send(res, 200, { ok: true });
  }

  // ---- VEHICLES ----
  if (pathname === '/api/vehicles' && method === 'GET') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    let list = read('vehicles');
    if (auth.role !== 'platform_admin') list = list.filter(v => v.company_id === auth.company_id);
    return send(res, 200, { vehicles: list });
  }

  if (pathname === '/api/vehicles' && method === 'POST') {
    const auth = requireAuth(req, res);
    if (!auth || !auth.company_id) return send(res, 400, { error: 'No company' });
    const company = read('companies').find(c => c.id === auth.company_id);
    const vehicles = read('vehicles').filter(v => v.company_id === auth.company_id);
    if (company && vehicles.length >= (company.vehicle_limit || 5) && company.subscription_status !== 'trial') {
      return send(res, 402, { error: 'Vehicle limit reached. Please upgrade your plan.' });
    }
    const { plate, type, make, model, year, status } = body;
    if (!plate || !type) return send(res, 400, { error: 'plate and type required' });
    const vehicle = {
      id: uid(),
      company_id: auth.company_id,
      plate: plate.toUpperCase(),
      type: type === 'daladala' ? 'daladala' : 'truck',
      make: make || '',
      model: model || '',
      year: year || null,
      status: status || 'idle',
      odometer: body.odometer || 0,
      driver_id: null,
      created_at: now()
    };
    const all = read('vehicles');
    all.push(vehicle);
    write('vehicles', all);
    // update count
    const companies = read('companies');
    const idx = companies.findIndex(c => c.id === auth.company_id);
    if (idx >= 0) {
      companies[idx].current_vehicles = vehicles.length + 1;
      write('companies', companies);
    }
    return send(res, 201, { vehicle });
  }

  if (pathname.startsWith('/api/vehicles/') && method === 'PATCH') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const id = pathname.split('/')[3];
    const all = read('vehicles');
    const idx = all.findIndex(v => v.id === id && (auth.role === 'platform_admin' || v.company_id === auth.company_id));
    if (idx < 0) return send(res, 404, { error: 'Not found' });
    all[idx] = { ...all[idx], ...body, id: all[idx].id, company_id: all[idx].company_id };
    write('vehicles', all);
    return send(res, 200, { vehicle: all[idx] });
  }

  if (pathname.startsWith('/api/vehicles/') && method === 'DELETE') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const id = pathname.split('/')[3];
    let all = read('vehicles');
    const before = all.length;
    all = all.filter(v => !(v.id === id && (auth.role === 'platform_admin' || v.company_id === auth.company_id)));
    if (all.length === before) return send(res, 404, { error: 'Not found' });
    write('vehicles', all);
    return send(res, 200, { ok: true });
  }

  // ---- DRIVERS ----
  if (pathname === '/api/drivers' && method === 'GET') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    let list = read('drivers');
    if (auth.role !== 'platform_admin') list = list.filter(d => d.company_id === auth.company_id);
    return send(res, 200, { drivers: list });
  }

  if (pathname === '/api/drivers' && method === 'POST') {
    const auth = requireAuth(req, res);
    if (!auth || !auth.company_id) return;
    const { name, phone, license_no, license_expiry } = body;
    if (!name) return send(res, 400, { error: 'name required' });
    const driver = {
      id: uid(),
      company_id: auth.company_id,
      name,
      phone: phone || '',
      license_no: license_no || '',
      license_expiry: license_expiry || null,
      status: 'active',
      created_at: now()
    };
    const all = read('drivers');
    all.push(driver);
    write('drivers', all);
    return send(res, 201, { driver });
  }

  // ---- DASHBOARD STATS ----
  if (pathname === '/api/dashboard' && method === 'GET') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const companyId = auth.company_id;
    const vehicles = read('vehicles').filter(v => !companyId || v.company_id === companyId);
    const drivers = read('drivers').filter(d => !companyId || d.company_id === companyId);
    const onRoute = vehicles.filter(v => v.status === 'on_route').length;
    const workshop = vehicles.filter(v => v.status === 'workshop').length;
    const idle = vehicles.filter(v => v.status === 'idle').length;
    const trucks = vehicles.filter(v => v.type === 'truck').length;
    const daladala = vehicles.filter(v => v.type === 'daladala').length;
    return send(res, 200, {
      totals: {
        vehicles: vehicles.length,
        trucks,
        daladala,
        drivers: drivers.length,
        on_route: onRoute,
        workshop,
        idle,
        out_of_service: vehicles.filter(v => v.status === 'out_of_service').length
      },
      vehicles: vehicles.slice(0, 8),
      drivers: drivers.slice(0, 5)
    });
  }


  // ---- TRIPS ----
  if (pathname === '/api/trips' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { trips: mod.listTrips(auth) });
  }
  if (pathname === '/api/trips' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { trip: mod.createTrip(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/trips/') && method === 'PATCH') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const t = mod.updateTrip(auth, id, body);
    if (!t) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { trip: t });
  }

  // ---- MAINTENANCE ----
  if (pathname === '/api/maintenance' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { items: mod.listMaintenance(auth) });
  }
  if (pathname === '/api/maintenance' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { item: mod.createMaintenance(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/maintenance/') && method === 'PATCH') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const t = mod.updateMaintenance(auth, id, body);
    if (!t) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { item: t });
  }

  // ---- FUEL ----
  if (pathname === '/api/fuel' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { logs: mod.listFuel(auth), summary: mod.fuelSummary(auth) });
  }
  if (pathname === '/api/fuel' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { log: mod.createFuel(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }

  // ---- NOTIFICATIONS / REMINDERS ----
  if (pathname === '/api/admin/reminders/run' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const channel = body.channel || 'sms';
    const results = await notify.runSubscriptionReminders({ daysAhead: body.daysAhead || 3, channel });
    return send(res, 200, { results, demo: notify.DEMO });
  }
  if (pathname === '/api/notifications/test' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    const { phone, channel, message } = body;
    if (!phone) return send(res, 400, { error: 'phone required' });
    try {
      const r = channel === 'whatsapp'
        ? await notify.sendWhatsApp({ to: phone, message: message || 'MlimaniFleet test' })
        : await notify.sendSms({ to: phone, message: message || 'MlimaniFleet test SMS' });
      return send(res, 200, r);
    } catch (e) { return send(res, 502, { error: e.message }); }
  }



  // ---- SUPPLIER LOANS (fuel / parts on credit) ----
  if (pathname === '/api/loans' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { loans: fin.listLoans(auth) });
  }
  if (pathname === '/api/loans' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { loan: fin.createLoan(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/loans/') && pathname.endsWith('/pay') && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const loan = fin.payLoan(auth, id, body.amount);
    if (!loan) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { loan });
  }

  // ---- CLIENT INVOICES ----
  if (pathname === '/api/invoices' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { invoices: fin.listInvoices(auth) });
  }
  if (pathname === '/api/invoices' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { invoice: fin.createInvoice(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/invoices/') && pathname.endsWith('/pay') && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const inv = fin.recordClientPayment(auth, id, body.amount);
    if (!inv) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { invoice: inv });
  }

  // ---- FINANCE SUMMARY (P&L, debts) ----
  if (pathname === '/api/finance/summary' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, fin.financeSummary(auth));
  }

  // ---- GPS ----
  if (pathname === '/api/gps/devices' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { devices: gps.listDevices(auth) });
  }
  if (pathname === '/api/gps/devices' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { device: gps.registerDevice(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/gps/devices/') && method === 'PATCH') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[4];
    const d = gps.updateDevice(auth, id, body);
    if (!d) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { device: d });
  }
  if (pathname === '/api/gps/live' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { positions: gps.livePositions(auth) });
  }
  // Public webhook for tracker push (secure with shared secret in production)

  // ---------- Inventory ----------
  if (pathname === '/api/inventory' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { parts: inv.listParts(auth), moves: inv.listMoves(auth, 80), summary: inv.warehouseSummary(auth) });
  }
  if (pathname === '/api/inventory' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { part: inv.createPart(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/inventory/') && method === 'PATCH') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const part = inv.updatePart(auth, id, body);
    if (!part) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { part });
  }
  if (pathname.startsWith('/api/inventory/') && pathname.endsWith('/adjust') && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const part = inv.adjustStock(auth, id, body.delta, body.reason);
    if (!part) return send(res, 404, { error: 'Not found' });
    return send(res, 200, { part });
  }
  if (pathname.startsWith('/api/inventory/') && method === 'DELETE') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const ok = inv.deletePart(auth, id);
    return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
  }

  // ---------- Operating expenses ----------
  if (pathname === '/api/expenses' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { expenses: exp.listExpenses(auth), categories: exp.CATEGORIES });
  }
  if (pathname === '/api/expenses' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 201, { expense: exp.createExpense(auth, body) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/expenses/') && method === 'DELETE') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    const ok = exp.deleteExpense(auth, id);
    return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
  }


  if (pathname === '/api/inventory/receive' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 200, inv.receiveStock(auth, body)); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname === '/api/inventory/issue' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try { return send(res, 200, inv.issueStock(auth, body)); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  // ---------- Maintenance rules (odometer) ----------
  if (pathname === '/api/maintenance/rules' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { rules: mrules.getRules(auth), due: mrules.vehicleDueList(auth) });
  }
  if (pathname === '/api/maintenance/due' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    return send(res, 200, { due: mrules.vehicleDueList(auth) });
  }

  // ---------- Reports snapshot ----------
  if (pathname === '/api/reports/summary' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    const q = url.parse(req.url, true).query || {};
    const from = q.from || '';
    const to = q.to || '';
    const vehicleId = q.vehicle_id || '';
    const driverId = q.driver_id || '';

    const summary = fin.financeSummary(auth);
    const vehicles = (require('./db').read('vehicles') || []).filter(v => auth.role === 'platform_admin' || v.company_id === auth.company_id);
    let trips = (require('./db').read('trips') || []).filter(v => auth.role === 'platform_admin' || v.company_id === auth.company_id);
    let fuel = (require('./db').read('fuel_logs') || []).filter(v => auth.role === 'platform_admin' || v.company_id === auth.company_id);
    let maint = (require('./db').read('maintenance') || []).filter(v => auth.role === 'platform_admin' || v.company_id === auth.company_id);
    let invoices = (require('./db').read('client_invoices') || []).filter(v => auth.role === 'platform_admin' || v.company_id === auth.company_id);

    const inRange = (dateStr) => {
      if (!dateStr) return true;
      const d = String(dateStr).slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    trips = trips.filter(t => inRange(t.start_date || t.created_at) && (!vehicleId || t.vehicle_id === vehicleId) && (!driverId || t.driver_id === driverId));
    fuel = fuel.filter(f => inRange(f.date || f.created_at) && (!vehicleId || f.vehicle_id === vehicleId));
    maint = maint.filter(m => inRange(m.due_date || m.created_at) && (!vehicleId || m.vehicle_id === vehicleId));
    invoices = invoices.filter(i => inRange(i.invoice_date || i.created_at) && (!vehicleId || i.vehicle_id === vehicleId));

    const tripRev = trips.reduce((s, t) => s + (t.revenue_tzs || 0), 0);
    const invRev = invoices.reduce((s, i) => s + (i.amount_paid_tzs || 0), 0);
    const fuelCost = fuel.reduce((s, f) => s + (f.cost_tzs || 0), 0);
    const maintCost = maint.reduce((s, m) => s + (m.cost_tzs || 0), 0);

    const onRoute = vehicles.filter(v => v.status === 'on_route' || v.status === 'on route').length;
    const util = vehicles.length ? Math.round((onRoute / vehicles.length) * 100) : 0;
    const due = mrules.vehicleDueList(auth).filter(d => d.status !== 'ok' && (!vehicleId || d.vehicle_id === vehicleId));
    const parts = inv.listParts(auth);
    const lowStock = parts.filter(p => p.stock <= p.min_stock);
    const drivers = (require('./db').read('drivers') || []).filter(d => auth.role === 'platform_admin' || d.company_id === auth.company_id);

    return send(res, 200, {
      filters: { from, to, vehicle_id: vehicleId, driver_id: driverId },
      pnl: {
        ...summary.pnl,
        filtered_trip_revenue_tzs: tripRev,
        filtered_invoice_collected_tzs: invRev,
        filtered_fuel_cost_tzs: fuelCost,
        filtered_maintenance_cost_tzs: maintCost,
        filtered_net_tzs: (tripRev || invRev) - fuelCost - maintCost
      },
      payables: summary.payables,
      receivables: summary.receivables,
      alerts: summary.alerts,
      fleet: {
        total: vehicles.length,
        on_route: onRoute,
        workshop: vehicles.filter(v => v.status === 'workshop').length,
        utilization_pct: util
      },
      trips_count: trips.length,
      trips: trips.slice(0, 50),
      fuel_logs: fuel.slice(0, 50),
      maintenance_items: maint.slice(0, 50),
      maintenance_due: due.length,
      due_list: due.slice(0, 20),
      low_stock_parts: lowStock.length,
      vehicles,
      drivers
    });
  }

  if (pathname === '/api/gps/webhook' && method === 'POST') {
    const secret = process.env.GPS_WEBHOOK_SECRET;
    if (secret && req.headers['x-gps-secret'] !== secret) {
      return send(res, 401, { error: 'Invalid webhook secret' });
    }
    const result = gps.ingestPosition({
      imei: body.imei || body.device_id,
      device_id: body.device_id,
      lat: body.lat || body.latitude,
      lng: body.lng || body.longitude || body.lon,
      speed: body.speed,
      heading: body.heading || body.course,
      company_id: body.company_id,
      raw: body
    });
    return send(res, result.ok ? 200 : 400, result);
  }



  // ---- TEAM / SUB-USERS ----
  if (pathname === '/api/team' && method === 'GET') {
    const auth = requireAuth(req, res); if (!auth) return;
    if (!auth.company_id) return send(res, 400, { error: 'No company' });
    return send(res, 200, { users: team.listCompanyUsers(auth), presets: team.getPresets() });
  }
  if (pathname === '/api/team' && method === 'POST') {
    const auth = requireAuth(req, res); if (!auth) return;
    try {
      const user = team.createCompanyUser(auth, body);
      return send(res, 201, { user });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/team/') && method === 'PATCH') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    try {
      const user = team.updateCompanyUser(auth, id, body);
      if (!user) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { user });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (pathname.startsWith('/api/team/') && method === 'DELETE') {
    const auth = requireAuth(req, res); if (!auth) return;
    const id = pathname.split('/')[3];
    try {
      const ok = team.deleteCompanyUser(auth, id);
      if (!ok) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  send(res, 404, { error: 'API route not found', path: pathname });
}

// ---------- Server ----------
seedIfEmpty();
// Seed trips/maintenance/fuel for demo company
(function () {
  const cos = read('companies');
  if (cos[0]) {
    mod.seedModules(cos[0].id);
    fin.seedFinance(cos[0].id);
    gps.seedGps(cos[0].id);
    inv.seedInventory(cos[0].id);
  }
})();
initPg().catch(e => console.warn('PG init', e.message));

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (e) {
      console.error(e);
      send(res, 500, { error: 'Internal server error', detail: e.message });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║     MlimaniFleet ERP  —  Ready           ║');
  console.log(`  ║     http://localhost:${PORT}                 ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Platform admin: set ADMIN_EMAIL / ADMIN_PASSWORD env or use seed defaults');
  if (process.env.SEED_DEMO !== 'false') console.log('  Demo fleet: demo@mlimanifleet.tz / demo123');
  console.log(`  Payment mode: ${DEMO ? 'DEMO (auto-success)' : 'LIVE'}`);
  console.log('');
});
