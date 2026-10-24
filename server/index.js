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
const { hashPassword, verifyPassword, createToken, verifyToken, normalizePhone, isPhoneLike } = require('./auth');
const { selcomCreateOrder, pawapayDeposit, selcomQueryOrder, pawapayDepositStatus, TZA_PROVIDERS, DEMO } = require('./payments');
const { getPricingTiers, priceForCount } = require('./pricing');
const mod = require('./modules');
const notify = require('./notifications');
const { initDb } = require('./db');
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

/** Subscription access for a company record */
function getSubscriptionState(company) {
  if (!company) return { ok: true, status: 'none', locked: false, reason: '' };
  const st = company.subscription_status || 'trial';
  const today = new Date().toISOString().slice(0, 10);
  if (st === 'suspended') {
    return { ok: false, status: st, locked: true, reason: 'Account suspended. Contact MlimaniFleet to restore access.' };
  }
  if (st === 'past_due') {
    return { ok: false, status: st, locked: true, reason: 'Payment overdue. Pay your subscription or contact support after paying.' };
  }
  if (st === 'trial') {
    const ends = (company.trial_ends || '').slice(0, 10);
    if (ends && ends < today) {
      return { ok: false, status: 'trial_expired', locked: true, reason: 'Free trial ended. Pay to continue using MlimaniFleet.' };
    }
    return { ok: true, status: 'trial', locked: false, reason: '', trial_ends: company.trial_ends };
  }
  if (st === 'active') {
    const next = (company.next_billing_date || '').slice(0, 10);
    if (next && next < today) {
      return { ok: false, status: 'expired', locked: true, reason: 'Subscription period ended. Renew to continue.' };
    }
    return { ok: true, status: 'active', locked: false, reason: '', next_billing_date: company.next_billing_date };
  }
  return { ok: false, status: st, locked: true, reason: 'Subscription inactive. Please pay to continue.' };
}

function loadCompanyForAuth(auth) {
  if (!auth || !auth.company_id) return null;
  return (read('companies') || []).find(c => c.id === auth.company_id) || null;
}

/** Block operational APIs when subscription locked. Platform admin always allowed. */
function requireActiveSubscription(req, res, auth) {
  if (!auth) return null;
  if (auth.role === 'platform_admin') return auth;
  const company = loadCompanyForAuth(auth);
  const state = getSubscriptionState(company);
  if (state.locked) {
    send(res, 402, {
      error: state.reason || 'Subscription required',
      code: 'SUBSCRIPTION_LOCKED',
      subscription: state
    });
    return null;
  }
  return auth;
}

const SUBSCRIPTION_FREE_PATHS = [
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/profile',
  '/api/auth/login',
  '/api/auth/register',
  '/api/billing/summary',
  '/api/billing/pay',
  '/api/billing/upgrade-slots',
  '/api/pricing',
  '/api/company/profile',
  '/api/webhooks/selcom',
  '/api/webhooks/pawapay'
];

function isSubscriptionFreePath(pathname) {
  if (SUBSCRIPTION_FREE_PATHS.includes(pathname)) return true;
  if (pathname.startsWith('/api/admin/')) return true;
  if (pathname.startsWith('/api/webhooks/')) return true;
  return false;
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
    usd_tzs_rate: 2600,
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


  // ---- SUBSCRIPTION GATE (lock unpaid / expired) ----
  if (pathname.startsWith('/api/') && method !== 'OPTIONS') {
    if (!isSubscriptionFreePath(pathname)) {
      const authGate = getAuth(req);
      if (authGate && authGate.role !== 'platform_admin' && authGate.company_id) {
        const companyGate = loadCompanyForAuth(authGate);
        const stGate = getSubscriptionState(companyGate);
        if (stGate.locked) {
          return send(res, 402, {
            error: stGate.reason || 'Subscription required',
            code: 'SUBSCRIPTION_LOCKED',
            subscription: stGate
          });
        }
      }
    }
  }

  // ---- AUTH ----
  if (pathname === '/api/auth/register' && method === 'POST') {
    const { password, name, company_name } = body;
    let email = (body.email || '').trim().toLowerCase();
    let phone = normalizePhone(body.phone || '');
    if (!password || !company_name) return send(res, 400, { error: 'Company name and password required' });
    if (!phone && !email) return send(res, 400, { error: 'Provide mobile number or email' });
    if (phone && !/^255[67]\d{8}$/.test(phone)) {
      return send(res, 400, { error: 'Enter a valid Tanzania mobile (e.g. 07XXXXXXXX)' });
    }
    if (!email && phone) email = phone + '@phone.mlimanifleet.tz';
    const users = read('users');
    if (email && !email.includes('@phone.mlimanifleet') && users.find(u => (u.email || '').toLowerCase() === email)) {
      return send(res, 409, { error: 'Email already registered' });
    }
    if (phone && users.find(u => normalizePhone(u.phone) === phone)) {
      return send(res, 409, { error: 'Mobile number already registered' });
    }

    const companyId = uid();
    const userId = uid();
    const companies = read('companies');
    companies.push({
      id: companyId,
      name: company_name,
      phone: phone || '',
      email: email.includes('@phone.mlimanifleet') ? '' : email,
      subscription_status: 'trial',
      vehicle_limit: Math.min(100, Math.max(1, Number(body.planned_vehicles) || Number(body.vehicle_slots) || 1)),
      current_vehicles: 0,
      paid_vehicle_slots: 0, // after payment, slots they have paid for; during trial limit is planned
      next_billing_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      trial_ends: new Date(Date.now() + 7 * 86400000).toISOString(),
      tin: '', vrn: '', address: '', city: '', vat_default: false, usd_tzs_rate: 2600,
      invoice_footer: 'Thank you for your business',
      created_at: now()
    });
    write('companies', companies);

    users.push({
      id: userId,
      email,
      phone: phone || '',
      password: hashPassword(password),
      name: name || company_name,
      role: 'fleet_manager',
      company_id: companyId,
      permissions: team.ROLE_PRESETS.fleet_manager.permissions,
      active: true,
      created_at: now()
    });
    write('users', users);

    const token = createToken({ id: userId, email, role: 'fleet_manager', company_id: companyId });
    return send(res, 201, {
      token,
      user: { id: userId, email, phone: phone || '', name: name || company_name, role: 'fleet_manager', company_id: companyId }
    });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const identity = (body.identity || body.email || body.phone || '').trim();
    const password = body.password || '';
    if (!identity || !password) return send(res, 400, { error: 'Email or mobile number and password required' });
    const users = read('users');
    let user = null;
    if (isPhoneLike(identity)) {
      const phone = normalizePhone(identity);
      user = users.find(u => normalizePhone(u.phone) === phone);
      if (!user) user = users.find(u => (u.email || '').includes(phone));
    } else {
      user = users.find(u => (u.email || '').toLowerCase() === identity.toLowerCase());
    }
    if (!user || !verifyPassword(password, user.password)) {
      return send(res, 401, { error: 'Invalid login or password' });
    }
    const token = createToken({ id: user.id, email: user.email, role: user.role, company_id: user.company_id });
    return send(res, 200, {
      token,
      user: { id: user.id, email: user.email, phone: user.phone, name: user.name, role: user.role, company_id: user.company_id, permissions: user.permissions || null }
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
    const sub = getSubscriptionState(company);
    return send(res, 200, {
      user: { id: user.id, email: user.email, phone: user.phone, name: user.name, role: user.role, company_id: user.company_id, permissions: user.permissions || null },
      company,
      subscription: sub
    });
  }

  if (pathname === '/api/auth/change-password' && method === 'POST') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { current_password, new_password } = body;
    if (!current_password || !new_password) return send(res, 400, { error: 'Current and new password required' });
    if (String(new_password).length < 6) return send(res, 400, { error: 'New password must be at least 6 characters' });
    const users = read('users');
    const i = users.findIndex(u => u.id === auth.id);
    if (i < 0) return send(res, 404, { error: 'User not found' });
    if (!verifyPassword(current_password, users[i].password)) {
      return send(res, 401, { error: 'Current password is incorrect' });
    }
    users[i].password = hashPassword(new_password);
    write('users', users);
    return send(res, 200, { ok: true, message: 'Password updated' });
  }

  if (pathname === '/api/auth/profile' && method === 'PUT') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const users = read('users');
    const i = users.findIndex(u => u.id === auth.id);
    if (i < 0) return send(res, 404, { error: 'User not found' });
    if (body.name != null) users[i].name = String(body.name).trim();
    if (body.phone != null) users[i].phone = normalizePhone(body.phone);
    write('users', users);
    return send(res, 200, {
      user: { id: users[i].id, email: users[i].email, phone: users[i].phone, name: users[i].name, role: users[i].role, company_id: users[i].company_id }
    });
  }



  if (pathname === '/api/admin/overview' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const companies = read('companies') || [];
    const vehicles = read('vehicles') || [];
    const users = read('users') || [];
    const payments = read('payments') || [];
    const nowMs = Date.now();
    const day = 86400000;
    const weekAgo = new Date(nowMs - 7 * day).toISOString();
    const monthAgo = new Date(nowMs - 30 * day).toISOString();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthStart = startOfMonth.toISOString();

    const completedPay = payments.filter(p => p.status === 'completed');
    const revenueAll = completedPay.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const revenueMonth = completedPay.filter(p => (p.completed_at || p.created_at || '') >= monthStart)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const revenueWeek = completedPay.filter(p => (p.completed_at || p.created_at || '') >= weekAgo)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const registeredWeek = companies.filter(c => (c.created_at || '') >= weekAgo);
    const registeredMonth = companies.filter(c => (c.created_at || '') >= monthAgo);

    const today = new Date().toISOString().slice(0, 10);
    const delayed = companies.filter(c => {
      if (c.subscription_status === 'trial') {
        return c.trial_ends && c.trial_ends.slice(0, 10) < today;
      }
      if (c.subscription_status === 'active') {
        return c.next_billing_date && c.next_billing_date < today;
      }
      return c.subscription_status === 'past_due' || c.subscription_status === 'suspended';
    });

    const trial = companies.filter(c => c.subscription_status === 'trial');
    const active = companies.filter(c => c.subscription_status === 'active');
    const fleetUsers = users.filter(u => u.role !== 'platform_admin');

    const clients = companies.map(c => {
      const vcount = vehicles.filter(v => v.company_id === c.id).length;
      const pays = payments.filter(p => p.company_id === c.id);
      const paid = pays.filter(p => p.status === 'completed').reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const pending = pays.filter(p => p.status === 'pending').length;
      return {
        ...c,
        vehicle_count: vcount,
        total_paid_tzs: paid,
        pending_payments: pending,
        is_delayed: delayed.some(d => d.id === c.id)
      };
    }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    const recentPayments = [...payments].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 30)
      .map(p => {
        const co = companies.find(c => c.id === p.company_id);
        return { ...p, company_name: co ? co.name : '—' };
      });

    return send(res, 200, {
      stats: {
        total_clients: companies.length,
        active_subscriptions: active.length,
        trials: trial.length,
        delayed: delayed.length,
        fleet_users: fleetUsers.length,
        total_vehicles: vehicles.length,
        revenue_all_tzs: revenueAll,
        revenue_month_tzs: revenueMonth,
        revenue_week_tzs: revenueWeek,
        registered_this_week: registeredWeek.length,
        registered_last_30_days: registeredMonth.length
      },
      clients,
      delayed,
      registered_week: registeredWeek,
      recent_payments: recentPayments
    });
  }


  if (pathname.startsWith('/api/admin/companies/') && pathname.endsWith('/mark-paid') && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const parts = pathname.split('/');
    const id = parts[4];
    const companies = read('companies') || [];
    const i = companies.findIndex(c => c.id === id);
    if (i < 0) return send(res, 404, { error: 'Company not found' });
    const days = Math.min(365, Math.max(1, Number(body.days) || 30));
    const next = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    companies[i].subscription_status = 'active';
    companies[i].next_billing_date = next;
    companies[i].last_manual_payment_at = now();
    companies[i].last_manual_payment_note = body.note || 'Manual payment confirmed by platform owner';
    if (body.vehicle_limit != null) {
      companies[i].vehicle_limit = Number(body.vehicle_limit);
      companies[i].paid_vehicle_slots = Number(body.vehicle_limit);
    } else if (body.vehicle_count != null) {
      companies[i].vehicle_limit = Number(body.vehicle_count);
      companies[i].paid_vehicle_slots = Number(body.vehicle_count);
    } else {
      // Keep limit; ensure at least current fleet size
      const vcount = (read('vehicles') || []).filter(v => v.company_id === id).length;
      if (vcount > (companies[i].vehicle_limit || 0)) {
        companies[i].vehicle_limit = vcount;
        companies[i].paid_vehicle_slots = vcount;
      }
    }
    write('companies', companies);

    // Optional payment record for owner reports
    const payments = read('payments') || [];
    const vehicles = (read('vehicles') || []).filter(v => v.company_id === id);
    const count = vehicles.length || Number(body.vehicle_count) || 1;
    const amount = body.amount_tzs != null ? Number(body.amount_tzs) : null;
    payments.push({
      id: uid(),
      company_id: id,
      amount: amount,
      currency: 'TZS',
      phone: companies[i].phone || '',
      gateway: 'manual',
      provider: 'manual',
      status: 'completed',
      vehicle_count: count,
      note: body.note || 'Marked paid by owner',
      completed_at: now(),
      created_at: now()
    });
    write('payments', payments);

    return send(res, 200, {
      ok: true,
      company: companies[i],
      message: 'Marked paid — active until ' + next
    });
  }

  if (pathname.startsWith('/api/admin/companies/') && method === 'PATCH') {
    if (!requireAdmin(req, res)) return;
    const id = pathname.split('/')[4];
    const companies = read('companies');
    const i = companies.findIndex(c => c.id === id);
    if (i < 0) return send(res, 404, { error: 'Company not found' });
    const allowed = ['subscription_status', 'vehicle_limit', 'next_billing_date', 'name', 'phone', 'email'];
    for (const k of allowed) if (body[k] !== undefined) companies[i][k] = body[k];
    write('companies', companies);
    return send(res, 200, { company: companies[i] });
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
    const fields = ['name','phone','email','address','city','tin','vrn','vat_default','invoice_footer','usd_tzs_rate'];
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


  if (pathname === '/api/billing/upgrade-slots' && method === 'POST') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (auth.role === 'platform_admin') return send(res, 403, { error: 'Not for platform admin' });
    if (!auth.company_id) return send(res, 400, { error: 'No company' });
    const additional = Math.min(100, Math.max(1, Number(body.additional_vehicles) || 1));
    const company = read('companies').find(c => c.id === auth.company_id);
    if (!company) return send(res, 404, { error: 'Company not found' });
    const vehicles = read('vehicles').filter(v => v.company_id === auth.company_id);
    const currentLimit = Number(company.vehicle_limit) || 0;
    const newLimit = currentLimit + additional;
    const { amount: rate } = priceForCount(1);
    const unit = rate || 10000;
    const amount = additional * unit;
    // Quote only if no payment phone — or initiate payment
    if (!body.phone && !body.confirm_quote_only) {
      return send(res, 200, {
        quote: true,
        additional_vehicles: additional,
        current_limit: currentLimit,
        new_limit: newLimit,
        current_vehicles: vehicles.length,
        price_per_vehicle_tzs: unit,
        amount_tzs: amount,
        message: `Pay TZS ${amount.toLocaleString()} to increase limit from ${currentLimit} to ${newLimit} vehicles`
      });
    }
    // Record pending upgrade payment (manual or gateway)
    const orderId = uid();
    const payments = read('payments') || [];
    payments.push({
      id: orderId,
      company_id: auth.company_id,
      amount,
      currency: 'TZS',
      phone: body.phone || company.phone || '',
      gateway: body.gateway || 'manual_pending',
      provider: body.provider || null,
      status: body.mark_pending === false ? 'pending' : 'pending',
      vehicle_count: newLimit,
      upgrade_additional: additional,
      previous_limit: currentLimit,
      new_limit: newLimit,
      purpose: 'vehicle_slots',
      created_at: now()
    });
    write('payments', payments);

    // If DEMO payment mode, auto-apply upgrade
    if (DEMO || body.simulate_paid) {
      const companies = read('companies');
      const ci = companies.findIndex(c => c.id === auth.company_id);
      if (ci >= 0) {
        companies[ci].vehicle_limit = newLimit;
        companies[ci].paid_vehicle_slots = newLimit;
        companies[ci].subscription_status = 'active';
        companies[ci].next_billing_date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        write('companies', companies);
      }
      const pi = payments.findIndex(p => p.id === orderId);
      if (pi >= 0) {
        payments[pi].status = 'completed';
        payments[pi].completed_at = now();
        write('payments', payments);
      }
      return send(res, 200, {
        ok: true,
        activated: true,
        vehicle_limit: newLimit,
        amount_tzs: amount,
        message: `Slots increased to ${newLimit}. You can add more vehicles now.`
      });
    }

    return send(res, 200, {
      ok: true,
      pending: true,
      payment_id: orderId,
      amount_tzs: amount,
      new_limit: newLimit,
      message: 'Payment initiated. After M-Pesa is confirmed, platform owner can Mark paid with the new vehicle limit.'
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
    const limit = Number(company?.vehicle_limit) || 0;
    if (!company || vehicles.length >= limit) {
      const need = vehicles.length + 1;
      const extra = Math.max(1, need - limit);
      const { amount: unitAmount } = priceForCount(1);
      const rate = unitAmount || 10000;
      return send(res, 402, {
        error: `Vehicle limit reached (${vehicles.length}/${limit}). Pay for more vehicle slots to add another unit.`,
        code: 'VEHICLE_LIMIT',
        current_vehicles: vehicles.length,
        vehicle_limit: limit,
        extra_slots_needed: extra,
        price_per_vehicle_tzs: rate,
        upgrade_amount_tzs: extra * rate
      });
    }
    const { plate, type, make, model, year, status } = body;
    if (!plate || !type) return send(res, 400, { error: 'plate and type required' });
    const allowedTypes = ['truck', 'daladala', 'tipper', 'bus', 'pickup', 'trailer', 'other'];
    const vtype = allowedTypes.includes(type) ? type : 'truck';
    const vehicle = {
      id: uid(),
      company_id: auth.company_id,
      plate: plate.toUpperCase(),
      type: vtype,
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

(async function boot() {
  try {
    const dbInfo = await initDb();
    console.log('Storage mode:', dbInfo.mode);
  } catch (e) {
    console.warn('DB init error', e.message);
  }
  seedIfEmpty();
  try {
    const cos = read('companies');
    if (cos[0]) {
      mod.seedModules(cos[0].id);
      fin.seedFinance(cos[0].id);
      gps.seedGps(cos[0].id);
      inv.seedInventory(cos[0].id);
    }
  } catch (e) {
    console.warn('Seed modules', e.message);
  }

  server.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║     MlimaniFleet ERP  —  Ready           ║');
    console.log(`  ║     http://localhost:${PORT}                 ║`);
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
    console.log('  Platform admin: admin@mlimanifleet.tz (change password after launch)');
    if (process.env.SEED_DEMO !== 'false') console.log('  Demo fleet: demo@mlimanifleet.tz / demo123');
    console.log(`  Payment mode: ${DEMO ? 'DEMO (auto-success)' : 'LIVE'}`);
    console.log('');
  });
})();
