/**
 * MlimaniFleet Frontend Application
 */
const API = '';
let token = localStorage.getItem('mf_token');
let currentUser = null;
let currentCompany = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showLogin() {
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
}
function showRegister() {
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
}

async function doLogin(e) {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
      })
    });
    token = data.token;
    localStorage.setItem('mf_token', token);
    currentUser = data.user;
    await bootApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
  return false;
}

async function doRegister(e) {
  e.preventDefault();
  const err = document.getElementById('reg-error');
  err.classList.add('hidden');
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        company_name: document.getElementById('reg-company').value,
        name: document.getElementById('reg-name').value,
        email: document.getElementById('reg-email').value,
        phone: document.getElementById('reg-phone').value,
        password: document.getElementById('reg-password').value
      })
    });
    token = data.token;
    localStorage.setItem('mf_token', token);
    currentUser = data.user;
    await bootApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
  return false;
}

function logout() {
  token = null;
  localStorage.removeItem('mf_token');
  currentUser = null;
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  showLogin();
}

async function bootApp() {
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    currentCompany = me.company;
  } catch {
    logout();
    return;
  }
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.name;
  const isAdmin = currentUser.role === 'platform_admin';
  const isManager = currentUser.role === 'fleet_manager' || (currentUser.permissions && currentUser.permissions.team);
  document.getElementById('user-role').textContent = isAdmin ? 'Platform Admin' : (currentUser.role === 'fleet_manager' ? 'Fleet Manager' : (currentUser.role || 'User').replace(/_/g,' '));
  document.getElementById('user-avatar').textContent = (currentUser.name || '?').slice(0, 2).toUpperCase();
  // Permission map for nav (fleet_manager = full access)
  const perms = currentUser.permissions || (
    currentUser.role === 'fleet_manager'
      ? { vehicles:true,drivers:true,trips:true,maintenance:true,fuel:true,finance:true,gps:true,inventory:true,reports:true,billing:true,team:true }
      : currentUser.role === 'platform_admin' ? {} : {}
  );
  window.currentPerms = perms;

  if (isAdmin) {
    document.getElementById('admin-nav').classList.remove('hidden');
    // Platform admin: never show SaaS payment plans / subscription
    document.getElementById('nav-subscription')?.classList.add('hidden');
    document.getElementById('btn-subscription')?.classList.add('hidden');
    document.getElementById('nav-team')?.classList.add('hidden');
    document.getElementById('sub-badge')?.classList.add('hidden');
    // Hide company-ops nav that admin doesn't need daily
    ['nav-subscription'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  } else {
    document.getElementById('admin-nav')?.classList.add('hidden');
    // Subscription only for users with billing permission
    if (perms.billing) {
      document.getElementById('nav-subscription')?.classList.remove('hidden');
      document.getElementById('btn-subscription')?.classList.remove('hidden');
    } else {
      document.getElementById('nav-subscription')?.classList.add('hidden');
      document.getElementById('btn-subscription')?.classList.add('hidden');
    }
    if (isManager || perms.team) document.getElementById('nav-team')?.classList.remove('hidden');
    else document.getElementById('nav-team')?.classList.add('hidden');

    // Hide modules without permission
    const navMap = {
      vehicles: 'vehicles', drivers: 'drivers', trips: 'trips', maintenance: 'maintenance',
      fuel: 'fuel', tracking: 'gps', inventory: 'inventory', finance: 'finance', reports: 'reports'
    };
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      const page = el.dataset.page;
      if (['dashboard','team','billing','admin-pricing','admin-companies'].includes(page)) return;
      const key = navMap[page];
      if (key && perms[key] === false) el.classList.add('hidden');
      else if (key) el.classList.remove('hidden');
    });

    if (currentCompany) {
      const badge = document.getElementById('sub-badge');
      badge.classList.remove('hidden');
      const st = currentCompany.subscription_status;
      badge.textContent = st === 'active' ? 'Active plan' : st === 'trial' ? 'Trial' : st;
      badge.className = 'text-xs px-2.5 py-1 rounded-full font-medium ' +
        (st === 'active' ? 'bg-emerald-50 text-emerald-700' : st === 'trial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700');
    }
  }
  bindNav();
  showPage('dashboard');
  lucide.createIcons();
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      showPage(el.dataset.page);
    };
  });
}

const titles = {
  dashboard: ['Dashboard', 'Overview of your fleet'],
  vehicles: ['Vehicles', 'Trucks & Dala Dala register'],
  drivers: ['Drivers', 'Driver profiles & licenses'],
  trips: ['Trips & Routes', 'Long-haul and dala dala trips'],
  maintenance: ['Maintenance', 'Service schedules and work orders'],
  fuel: ['Fuel Management', 'Logs, cost and consumption'],
  tracking: ['Live Tracking', 'Real-time vehicle positions'],
  inventory: ['Parts Inventory', 'Spare parts stock and usage'],
  finance: ['Finance & Billing', 'Revenue, invoices and expenses'],
  reports: ['Reports', 'Operational and financial insights'],
  team: ['Team', 'Company users and permissions'],
  billing: ['Subscription', 'Plans and mobile money payments'],
  'admin-pricing': ['Pricing Plans', 'Adjust monthly subscription prices'],
  'admin-companies': ['Companies', 'All tenant fleets']
};

async function showPage(page) {
  // Platform admin must not see SaaS payment plans
  if (currentUser && currentUser.role === 'platform_admin' && page === 'billing') {
    page = 'admin-companies';
  }
  // Sub-user permission check
  if (currentUser && currentUser.role !== 'platform_admin' && currentUser.role !== 'fleet_manager') {
    const pmap = { vehicles:'vehicles', drivers:'drivers', trips:'trips', maintenance:'maintenance',
      fuel:'fuel', tracking:'gps', inventory:'inventory', finance:'finance', reports:'reports', billing:'billing', team:'team' };
    const need = pmap[page];
    if (need && window.currentPerms && window.currentPerms[need] === false) {
      page = 'dashboard';
    }
  }
  const [t, s] = titles[page] || [page, ''];
  document.getElementById('page-title').textContent = t;
  document.getElementById('page-subtitle').textContent = s;
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="text-center py-20 text-slate-400">Loading…</div>';
  try {
    if (page === 'dashboard') main.innerHTML = await renderDashboard();
    else if (page === 'vehicles') main.innerHTML = await renderVehicles();
    else if (page === 'drivers') main.innerHTML = await renderDrivers();
    else if (page === 'trips') main.innerHTML = await renderTrips();
    else if (page === 'maintenance') main.innerHTML = await renderMaintenance();
    else if (page === 'fuel') main.innerHTML = await renderFuel();
    else if (page === 'tracking') main.innerHTML = await renderTracking();
    else if (page === 'inventory') main.innerHTML = await renderInventory();
    else if (page === 'finance') main.innerHTML = await renderFinance();
    else if (page === 'reports') main.innerHTML = await renderReports();
    else if (page === 'team') main.innerHTML = await renderTeam();
    else if (page === 'billing') main.innerHTML = await renderBilling();
    else if (page === 'admin-pricing') main.innerHTML = await renderAdminPricing();
    else if (page === 'admin-companies') main.innerHTML = await renderAdminCompanies();
    else main.innerHTML = '<p>Coming soon</p>';
  } catch (e) {
    main.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-xl">${e.message}</div>`;
  }
  lucide.createIcons();
}

function fmt(n) {
  return new Intl.NumberFormat('en-TZ').format(n);
}

async function renderDashboard() {
  const d = await api('/api/dashboard');
  const t = d.totals;
  return `
  <div class="page-enter space-y-6">
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      ${kpi('Total Vehicles', t.vehicles, `${t.trucks} trucks · ${t.daladala} dala dala`, 'truck', 'brand')}
      ${kpi('On Route', t.on_route, 'Active trips', 'route', 'emerald')}
      ${kpi('In Workshop', t.workshop, 'Maintenance', 'wrench', 'amber')}
      ${kpi('Drivers', t.drivers, 'Registered', 'users', 'violet')}
    </div>
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div class="px-5 py-4 border-b border-slate-100 font-semibold">Fleet snapshot</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs text-slate-500 border-b">
            <th class="px-5 py-3">Plate</th><th class="py-3">Type</th><th class="py-3">Make</th><th class="py-3">Status</th><th class="py-3">Odometer</th>
          </tr></thead>
          <tbody class="divide-y divide-slate-50">
            ${d.vehicles.map(v => `
              <tr class="hover:bg-slate-50">
                <td class="px-5 py-3 font-medium">${v.plate}</td>
                <td class="py-3"><span class="px-2 py-0.5 text-xs rounded ${v.type==='truck'?'bg-blue-50 text-blue-700':'bg-violet-50 text-violet-700'}">${v.type}</span></td>
                <td class="py-3 text-slate-600">${v.make||'—'} ${v.model||''}</td>
                <td class="py-3">${statusBadge(v.status)}</td>
                <td class="py-3 text-slate-600">${fmt(v.odometer||0)} km</td>
              </tr>`).join('') || '<tr><td colspan="5" class="px-5 py-8 text-center text-slate-400">No vehicles yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function kpi(label, value, sub, icon, color) {
  const colors = { brand:'bg-brand-50 text-brand-600', emerald:'bg-emerald-50 text-emerald-600', amber:'bg-amber-50 text-amber-600', violet:'bg-violet-50 text-violet-600' };
  return `<div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
    <div class="flex justify-between">
      <div>
        <p class="text-sm text-slate-500 font-medium">${label}</p>
        <p class="text-3xl font-bold mt-1">${value}</p>
        <p class="text-xs text-slate-500 mt-2">${sub}</p>
      </div>
      <div class="w-11 h-11 rounded-xl ${colors[color]||colors.brand} flex items-center justify-center">
        <i data-lucide="${icon}" class="w-5 h-5"></i>
      </div>
    </div>
  </div>`;
}

function statusBadge(s) {
  const map = {
    on_route: 'bg-emerald-50 text-emerald-700',
    idle: 'bg-blue-50 text-blue-700',
    workshop: 'bg-amber-50 text-amber-700',
    out_of_service: 'bg-red-50 text-red-700'
  };
  return `<span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded ${map[s]||'bg-slate-100'}">${(s||'').replace(/_/g,' ')}</span>`;
}

async function renderVehicles() {
  const { vehicles } = await api('/api/vehicles');
  return `
  <div class="page-enter space-y-5">
    <div class="flex justify-between items-center">
      <p class="text-sm text-slate-500">${vehicles.length} vehicle(s)</p>
      <button onclick="openAddVehicle()" class="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Add vehicle
      </button>
    </div>
    <div id="add-vehicle-form" class="hidden bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <h3 class="font-semibold">New vehicle</h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <input id="v-plate" placeholder="Plate e.g. T 123 ABC" class="px-3 py-2 border rounded-lg text-sm">
        <select id="v-type" class="px-3 py-2 border rounded-lg text-sm"><option value="truck">Truck</option><option value="daladala">Dala Dala</option></select>
        <input id="v-make" placeholder="Make" class="px-3 py-2 border rounded-lg text-sm">
        <input id="v-model" placeholder="Model" class="px-3 py-2 border rounded-lg text-sm">
        <input id="v-year" type="number" placeholder="Year" class="px-3 py-2 border rounded-lg text-sm">
        <select id="v-status" class="px-3 py-2 border rounded-lg text-sm">
          <option value="idle">Idle</option><option value="on_route">On route</option><option value="workshop">Workshop</option>
        </select>
      </div>
      <div class="flex gap-2">
        <button onclick="saveVehicle()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
        <button onclick="document.getElementById('add-vehicle-form').classList.add('hidden')" class="px-4 py-2 rounded-lg text-sm border">Cancel</button>
      </div>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Plate</th><th class="py-3">Type</th><th class="py-3">Make / Model</th><th class="py-3">Status</th><th class="py-3">Odometer</th><th class="py-3"></th>
        </tr></thead>
        <tbody class="divide-y">
          ${vehicles.map(v => `
            <tr class="hover:bg-slate-50">
              <td class="px-5 py-3 font-medium">${v.plate}</td>
              <td class="py-3"><span class="px-2 py-0.5 text-xs rounded ${v.type==='truck'?'bg-blue-50 text-blue-700':'bg-violet-50 text-violet-700'}">${v.type}</span></td>
              <td class="py-3">${v.make||'—'} ${v.model||''}</td>
              <td class="py-3">${statusBadge(v.status)}</td>
              <td class="py-3">${fmt(v.odometer||0)} km</td>
              <td class="py-3 pr-5 text-right">
                <button onclick="deleteVehicle('${v.id}')" class="text-red-500 hover:text-red-700 text-xs">Delete</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="px-5 py-10 text-center text-slate-400">No vehicles. Add your first truck or dala dala.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

function openAddVehicle() {
  document.getElementById('add-vehicle-form').classList.remove('hidden');
}

async function saveVehicle() {
  try {
    await api('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        plate: document.getElementById('v-plate').value,
        type: document.getElementById('v-type').value,
        make: document.getElementById('v-make').value,
        model: document.getElementById('v-model').value,
        year: document.getElementById('v-year').value,
        status: document.getElementById('v-status').value
      })
    });
    showPage('vehicles');
  } catch (e) { alert(e.message); }
}

async function deleteVehicle(id) {
  if (!confirm('Delete this vehicle?')) return;
  await api('/api/vehicles/' + id, { method: 'DELETE' });
  showPage('vehicles');
}

async function renderDrivers() {
  const { drivers } = await api('/api/drivers');
  return `
  <div class="page-enter space-y-5">
    <div class="flex justify-between">
      <p class="text-sm text-slate-500">${drivers.length} driver(s)</p>
      <button onclick="openAddDriver()" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Add driver
      </button>
    </div>
    <div id="add-driver-form" class="hidden bg-white rounded-xl border p-5 space-y-4">
      <div class="grid sm:grid-cols-2 gap-4">
        <input id="d-name" placeholder="Full name" class="px-3 py-2 border rounded-lg text-sm">
        <input id="d-phone" placeholder="Phone" class="px-3 py-2 border rounded-lg text-sm">
        <input id="d-license" placeholder="License number" class="px-3 py-2 border rounded-lg text-sm">
        <input id="d-expiry" type="date" class="px-3 py-2 border rounded-lg text-sm">
      </div>
      <button onclick="saveDriver()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Name</th><th class="py-3">Phone</th><th class="py-3">License</th><th class="py-3">Expiry</th><th class="py-3">Status</th>
        </tr></thead>
        <tbody class="divide-y">
          ${drivers.map(d => `
            <tr><td class="px-5 py-3 font-medium">${d.name}</td>
            <td class="py-3">${d.phone||'—'}</td>
            <td class="py-3">${d.license_no||'—'}</td>
            <td class="py-3">${d.license_expiry||'—'}</td>
            <td class="py-3"><span class="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">${d.status}</span></td></tr>
          `).join('') || '<tr><td colspan="5" class="px-5 py-10 text-center text-slate-400">No drivers yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

function openAddDriver() { document.getElementById('add-driver-form').classList.remove('hidden'); }
async function saveDriver() {
  try {
    await api('/api/drivers', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('d-name').value,
        phone: document.getElementById('d-phone').value,
        license_no: document.getElementById('d-license').value,
        license_expiry: document.getElementById('d-expiry').value
      })
    });
    showPage('drivers');
  } catch (e) { alert(e.message); }
}

async function renderBilling() {
  const b = await api('/api/billing/summary');
  const tiers = (await api('/api/pricing')).tiers;
  return `
  <div class="page-enter space-y-6">
    <div class="grid lg:grid-cols-3 gap-5">
      <div class="lg:col-span-2 bg-white rounded-xl border p-6">
        <h3 class="font-semibold text-lg">Current subscription</h3>
        <div class="mt-4 grid sm:grid-cols-3 gap-4">
          <div class="p-4 bg-slate-50 rounded-xl">
            <div class="text-xs text-slate-500">Status</div>
            <div class="font-semibold mt-1 capitalize">${b.company?.subscription_status || '—'}</div>
          </div>
          <div class="p-4 bg-slate-50 rounded-xl">
            <div class="text-xs text-slate-500">Vehicles</div>
            <div class="font-semibold mt-1">${b.vehicle_count} / ${b.company?.vehicle_limit || '—'}</div>
          </div>
          <div class="p-4 bg-slate-50 rounded-xl">
            <div class="text-xs text-slate-500">Next billing</div>
            <div class="font-semibold mt-1">${b.company?.next_billing_date || '—'}</div>
          </div>
        </div>
        <div class="mt-6 p-5 bg-gradient-to-r from-brand-600 to-brand-800 rounded-xl text-white">
          <div class="text-brand-100 text-sm">Estimated monthly fee</div>
          <div class="text-3xl font-bold mt-1">TZS ${fmt(b.monthly_amount)}</div>
          <div class="text-sm text-brand-200 mt-1">${b.current_tier?.name || '—'} plan · ${b.vehicle_count} vehicle(s)</div>
        </div>

        <h4 class="font-semibold mt-8 mb-3">Pay with mobile money</h4>
        <div class="space-y-3 max-w-md">
          <input id="pay-phone" type="tel" placeholder="07XXXXXXXX or 2557..." value="${b.company?.phone || ''}"
            class="w-full px-3 py-2.5 border rounded-lg text-sm">
          <select id="pay-gateway" class="w-full px-3 py-2.5 border rounded-lg text-sm">
            <option value="selcom">Selcom (M-Pesa, Tigo, Airtel, Halo)</option>
            <option value="pawapay">PawaPay</option>
          </select>
          <select id="pay-provider" class="w-full px-3 py-2.5 border rounded-lg text-sm">
            ${b.providers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
          <button onclick="payNow()" class="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 rounded-lg">
            Pay TZS ${fmt(b.monthly_amount)} now
          </button>
          <p class="text-xs text-slate-500">DEMO mode: payment auto-succeeds and activates 30 days.</p>
        </div>
      </div>

      <div class="space-y-4">
        <div class="bg-white rounded-xl border p-5">
          <h4 class="font-semibold mb-3">All plans</h4>
          <div class="space-y-3">
            ${tiers.map(t => {
              const rate = t.price_per_vehicle || t.price_tzs || 0;
              const mode = t.pricing_mode || (t.price_per_vehicle ? 'per_vehicle' : 'flat');
              const priceLabel = mode === 'per_vehicle' ? `TZS ${fmt(rate)} / vehicle` : mode === 'base_plus' ? `TZS ${fmt(t.price_tzs||0)} + ${fmt(rate)}/extra` : `TZS ${fmt(t.price_tzs||0)}`;
              return `<div class="p-3 rounded-lg border ${b.current_tier?.id===t.id?'border-brand-500 bg-brand-50':'border-slate-100'}">
                <div class="flex justify-between items-center">
                  <div class="font-medium">${t.name}</div>
                  <div class="font-bold text-brand-700 text-right text-sm">${priceLabel}</div>
                </div>
                <div class="text-xs text-slate-500 mt-1">${t.min_vehicles}–${t.max_vehicles === 9999 ? '∞' : t.max_vehicles} vehicles / month</div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="bg-white rounded-xl border p-5">
          <h4 class="font-semibold mb-3">Recent payments</h4>
          ${b.payments.length ? b.payments.map(p => `
            <div class="flex justify-between text-sm py-2 border-b border-slate-50 last:border-0">
              <div>
                <div class="font-medium">TZS ${fmt(p.amount)}</div>
                <div class="text-xs text-slate-500">${p.created_at?.slice(0,10)} · ${p.gateway}</div>
              </div>
              <span class="text-xs px-2 py-0.5 rounded h-fit ${p.status==='completed'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}">${p.status}</span>
            </div>`).join('') : '<p class="text-sm text-slate-400">No payments yet</p>'}
        </div>
      </div>
    </div>
  </div>`;
}

async function payNow() {
  const phone = document.getElementById('pay-phone').value;
  if (!phone) return alert('Enter phone number');
  try {
    const res = await api('/api/billing/pay', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        gateway: document.getElementById('pay-gateway').value,
        provider: document.getElementById('pay-provider').value
      })
    });
    alert(res.message);
    showPage('billing');
  } catch (e) { alert(e.message); }
}

async function renderAdminPricing() {
  const { tiers } = await api('/api/admin/pricing');
  return `
  <div class="page-enter space-y-5">
    <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-900">
      <strong>How billing works:</strong> Monthly fee = number of vehicles × rate for that band.
      Example: 1 truck = TZS 10,000 · 5 trucks = TZS 50,000 · 40 trucks (Enterprise) = 40 × 7,500 = TZS 300,000.
      Edit rates below — changes apply to the next invoice calculation immediately.
    </div>
    <div class="bg-white rounded-xl border overflow-x-auto">
      <table class="w-full text-sm min-w-[720px]">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-4 py-3">Plan</th>
          <th class="py-3">Min veh.</th>
          <th class="py-3">Max veh.</th>
          <th class="py-3">Mode</th>
          <th class="py-3">Flat / base (TZS)</th>
          <th class="py-3">Per vehicle (TZS)</th>
          <th class="py-3">Active</th>
        </tr></thead>
        <tbody id="pricing-rows">
          ${tiers.map((t,i) => `
            <tr class="border-b border-slate-50">
              <td class="px-4 py-3"><input data-i="${i}" data-f="name" value="${t.name||''}" class="border rounded px-2 py-1 w-28"></td>
              <td class="py-3"><input data-i="${i}" data-f="min_vehicles" type="number" value="${t.min_vehicles}" class="border rounded px-2 py-1 w-16"></td>
              <td class="py-3"><input data-i="${i}" data-f="max_vehicles" type="number" value="${t.max_vehicles}" class="border rounded px-2 py-1 w-20"></td>
              <td class="py-3">
                <select data-i="${i}" data-f="pricing_mode" class="border rounded px-2 py-1 text-xs">
                  <option value="per_vehicle" ${(t.pricing_mode||'per_vehicle')==='per_vehicle'?'selected':''}>Per vehicle</option>
                  <option value="flat" ${t.pricing_mode==='flat'?'selected':''}>Flat band</option>
                  <option value="base_plus" ${t.pricing_mode==='base_plus'?'selected':''}>Base + per extra</option>
                </select>
              </td>
              <td class="py-3"><input data-i="${i}" data-f="price_tzs" type="number" value="${t.price_tzs||0}" class="border rounded px-2 py-1 w-24"></td>
              <td class="py-3"><input data-i="${i}" data-f="price_per_vehicle" type="number" value="${t.price_per_vehicle||0}" class="border rounded px-2 py-1 w-24"></td>
              <td class="py-3"><input data-i="${i}" data-f="active" type="checkbox" ${t.active!==false?'checked':''}></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <button onclick="savePricing(${tiers.length})" class="bg-brand-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium">Save pricing</button>
  </div>`;
}
async function savePricing(n) {
  const tiers = [];
  for (let i = 0; i < n; i++) {
    const get = (f) => document.querySelector(`[data-i="${i}"][data-f="${f}"]`);
    tiers.push({
      id: ['standard','enterprise','tier'+i][i] || ('tier'+i),
      name: get('name').value,
      min_vehicles: +get('min_vehicles').value,
      max_vehicles: +get('max_vehicles').value,
      pricing_mode: get('pricing_mode').value,
      price_tzs: +get('price_tzs').value || 0,
      price_per_vehicle: +get('price_per_vehicle').value || 0,
      active: get('active').checked,
      sort: i + 1
    });
  }
  await api('/api/admin/pricing', { method: 'PUT', body: JSON.stringify({ tiers }) });
  alert('Pricing saved. New calculations use these rates.');
  showPage('admin-pricing');
}

async function renderAdminCompanies() {
  const { companies } = await api('/api/admin/companies');
  return `
  <div class="page-enter bg-white rounded-xl border overflow-hidden">
    <table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
        <th class="px-5 py-3">Company</th><th class="py-3">Email</th><th class="py-3">Vehicles</th><th class="py-3">Status</th><th class="py-3">Next bill</th>
      </tr></thead>
      <tbody class="divide-y">
        ${companies.map(c => `
          <tr>
            <td class="px-5 py-3 font-medium">${c.name}</td>
            <td class="py-3">${c.email}</td>
            <td class="py-3">${c.vehicle_count} / ${c.vehicle_limit}</td>
            <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${c.subscription_status==='active'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}">${c.subscription_status}</span></td>
            <td class="py-3">${c.next_billing_date||'—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}



async function renderTrips() {
  const [{ trips }, { vehicles }, { drivers }] = await Promise.all([
    api('/api/trips'), api('/api/vehicles'), api('/api/drivers')
  ]);
  const vMap = Object.fromEntries(vehicles.map(v => [v.id, v.plate]));
  const dMap = Object.fromEntries(drivers.map(d => [d.id, d.name]));
  return `
  <div class="page-enter space-y-5">
    <div class="flex justify-between items-center">
      <p class="text-sm text-slate-500">${trips.length} trip(s)</p>
      <button onclick="document.getElementById('trip-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> New trip
      </button>
    </div>
    <div id="trip-form" class="hidden bg-white rounded-xl border p-5 space-y-3">
      <div class="grid sm:grid-cols-3 gap-3">
        <select id="t-vehicle" class="border rounded-lg px-3 py-2 text-sm"><option value="">Vehicle</option>${vehicles.map(v=>`<option value="${v.id}">${v.plate}</option>`).join('')}</select>
        <select id="t-driver" class="border rounded-lg px-3 py-2 text-sm"><option value="">Driver</option>${drivers.map(d=>`<option value="${d.id}">${d.name}</option>`).join('')}</select>
        <select id="t-type" class="border rounded-lg px-3 py-2 text-sm"><option value="long_haul">Long haul</option><option value="daladala">Dala dala</option></select>
        <input id="t-origin" placeholder="Origin" class="border rounded-lg px-3 py-2 text-sm">
        <input id="t-dest" placeholder="Destination" class="border rounded-lg px-3 py-2 text-sm">
        <input id="t-revenue" type="number" placeholder="Revenue TZS" class="border rounded-lg px-3 py-2 text-sm">
      </div>
      <button onclick="saveTrip()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save trip</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Route</th><th class="py-3">Vehicle</th><th class="py-3">Driver</th><th class="py-3">Type</th><th class="py-3">Status</th><th class="py-3">Revenue</th>
        </tr></thead>
        <tbody class="divide-y">
          ${trips.map(t => `
            <tr class="hover:bg-slate-50">
              <td class="px-5 py-3 font-medium">${t.origin||'—'} → ${t.destination||'—'}</td>
              <td class="py-3">${vMap[t.vehicle_id]||'—'}</td>
              <td class="py-3">${dMap[t.driver_id]||'—'}</td>
              <td class="py-3"><span class="text-xs px-2 py-0.5 rounded bg-slate-100">${t.type}</span></td>
              <td class="py-3">${statusBadge(t.status==='in_progress'?'on_route':t.status==='completed'?'idle':t.status)}</td>
              <td class="py-3">TZS ${fmt(t.revenue_tzs||0)}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="px-5 py-10 text-center text-slate-400">No trips yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}
async function saveTrip() {
  try {
    await api('/api/trips', { method:'POST', body: JSON.stringify({
      vehicle_id: document.getElementById('t-vehicle').value,
      driver_id: document.getElementById('t-driver').value,
      type: document.getElementById('t-type').value,
      origin: document.getElementById('t-origin').value,
      destination: document.getElementById('t-dest').value,
      revenue_tzs: +document.getElementById('t-revenue').value || 0,
      status: 'planned'
    })});
    showPage('trips');
  } catch(e) { alert(e.message); }
}

async function renderMaintenance() {
  const [{ items }, { vehicles }] = await Promise.all([api('/api/maintenance'), api('/api/vehicles')]);
  const vMap = Object.fromEntries(vehicles.map(v => [v.id, v.plate]));
  return `
  <div class="page-enter space-y-5">
    ${duePanel}

    <div class="flex justify-between">
      <p class="text-sm text-slate-500">${items.length} work order(s)</p>
      <button onclick="document.getElementById('mnt-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Schedule
      </button>
    </div>
    <div id="mnt-form" class="hidden bg-white rounded-xl border p-5 space-y-3">
      <div class="grid sm:grid-cols-3 gap-3">
        <select id="m-vehicle" class="border rounded-lg px-3 py-2 text-sm"><option value="">Vehicle</option>${vehicles.map(v=>`<option value="${v.id}">${v.plate}</option>`).join('')}</select>
        <select id="m-type" class="border rounded-lg px-3 py-2 text-sm">
          <option value="full_service">Full service</option><option value="oil_change">Oil change</option>
          <option value="tyre_rotation">Tyre rotation</option><option value="repair">Repair</option>
        </select>
        <select id="m-priority" class="border rounded-lg px-3 py-2 text-sm"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <input id="m-desc" placeholder="Description" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
        <input id="m-due" type="date" class="border rounded-lg px-3 py-2 text-sm">
      </div>
      <button onclick="saveMaint()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Vehicle</th><th class="py-3">Type</th><th class="py-3">Description</th><th class="py-3">Due</th><th class="py-3">Priority</th><th class="py-3">Status</th><th class="py-3"></th>
        </tr></thead>
        <tbody class="divide-y">
          ${items.map(m => `
            <tr>
              <td class="px-5 py-3 font-medium">${vMap[m.vehicle_id]||'—'}</td>
              <td class="py-3">${m.type}</td>
              <td class="py-3 text-slate-600">${m.description||''}</td>
              <td class="py-3">${m.due_date||'—'}</td>
              <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${m.priority==='high'?'bg-red-50 text-red-700':m.priority==='medium'?'bg-amber-50 text-amber-700':'bg-slate-100'}">${m.priority}</span></td>
              <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${m.status==='overdue'?'bg-red-50 text-red-700':m.status==='completed'?'bg-emerald-50 text-emerald-700':'bg-blue-50 text-blue-700'}">${m.status}</span></td>
              <td class="py-3 pr-5">${m.status!=='completed'?`<button onclick="completeMaint('${m.id}')" class="text-xs text-brand-600">Complete</button>`:''}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="px-5 py-10 text-center text-slate-400">No maintenance records</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}
async function saveMaint() {
  try {
    await api('/api/maintenance', { method:'POST', body: JSON.stringify({
      vehicle_id: document.getElementById('m-vehicle').value,
      type: document.getElementById('m-type').value,
      priority: document.getElementById('m-priority').value,
      description: document.getElementById('m-desc').value,
      due_date: document.getElementById('m-due').value,
      status: 'scheduled'
    })});
    showPage('maintenance');
  } catch(e) { alert(e.message); }
}
async function completeMaint(id) {
  await api('/api/maintenance/'+id, { method:'PATCH', body: JSON.stringify({ status: 'completed' }) });
  showPage('maintenance');
}

async function renderFuel() {
  const [{ logs, summary }, { vehicles }] = await Promise.all([api('/api/fuel'), api('/api/vehicles')]);
  const vMap = Object.fromEntries(vehicles.map(v => [v.id, v.plate]));
  return `
  <div class="page-enter space-y-5">
    <div class="grid sm:grid-cols-4 gap-4">
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">MTD liters</div><div class="text-2xl font-bold mt-1">${fmt(summary.mtd_liters)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">MTD cost</div><div class="text-2xl font-bold mt-1">TZS ${fmt(summary.mtd_cost_tzs)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">All-time liters</div><div class="text-2xl font-bold mt-1">${fmt(summary.total_liters)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">All-time cost</div><div class="text-2xl font-bold mt-1">TZS ${fmt(summary.total_cost_tzs)}</div></div>
    </div>
    <div class="flex justify-between">
      <p class="text-sm text-slate-500">${logs.length} log(s)</p>
      <button onclick="document.getElementById('fuel-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Log fuel
      </button>
    </div>
    <div id="fuel-form" class="hidden bg-white rounded-xl border p-5 space-y-3">
      <div class="grid sm:grid-cols-3 gap-3">
        <select id="f-vehicle" class="border rounded-lg px-3 py-2 text-sm"><option value="">Vehicle</option>${vehicles.map(v=>`<option value="${v.id}">${v.plate}</option>`).join('')}</select>
        <input id="f-liters" type="number" step="0.1" placeholder="Liters" class="border rounded-lg px-3 py-2 text-sm">
        <input id="f-cost" type="number" placeholder="Cost TZS" class="border rounded-lg px-3 py-2 text-sm">
        <input id="f-odo" type="number" placeholder="Odometer km" class="border rounded-lg px-3 py-2 text-sm">
        <input id="f-station" placeholder="Station" class="border rounded-lg px-3 py-2 text-sm">
        <input id="f-date" type="date" class="border rounded-lg px-3 py-2 text-sm">
      </div>
      <button onclick="saveFuel()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Date</th><th class="py-3">Vehicle</th><th class="py-3">Liters</th><th class="py-3">Cost</th><th class="py-3">Odometer</th><th class="py-3">Station</th>
        </tr></thead>
        <tbody class="divide-y">
          ${logs.slice().reverse().map(l => `
            <tr>
              <td class="px-5 py-3">${l.filled_at||'—'}</td>
              <td class="py-3 font-medium">${vMap[l.vehicle_id]||'—'}</td>
              <td class="py-3">${l.liters}</td>
              <td class="py-3">TZS ${fmt(l.cost_tzs||0)}</td>
              <td class="py-3">${fmt(l.odometer||0)} km</td>
              <td class="py-3">${l.station||'—'}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="px-5 py-10 text-center text-slate-400">No fuel logs</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}
async function saveFuel() {
  try {
    await api('/api/fuel', { method:'POST', body: JSON.stringify({
      vehicle_id: document.getElementById('f-vehicle').value,
      liters: +document.getElementById('f-liters').value,
      cost_tzs: +document.getElementById('f-cost').value,
      odometer: +document.getElementById('f-odo').value,
      station: document.getElementById('f-station').value,
      filled_at: document.getElementById('f-date').value
    })});
    showPage('fuel');
  } catch(e) { alert(e.message); }
}


async function renderTracking() {
  let positions = [];
  let devices = [];
  try {
    const live = await api('/api/gps/live');
    positions = live.positions || [];
    const dev = await api('/api/gps/devices');
    devices = dev.devices || [];
  } catch (e) {
    positions = [];
  }
  const online = positions.filter(p => p.online).length;
  return `
  <div class="page-enter space-y-5">
    <div class="flex justify-between items-center flex-wrap gap-3">
      <p class="text-sm text-slate-500">GPS devices: ${devices.length} · Online: ${online}</p>
      <button onclick="document.getElementById('gps-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Register GPS device
      </button>
    </div>
    <div id="gps-form" class="hidden bg-white rounded-xl border p-5 space-y-3">
      <p class="text-xs text-slate-500">Link a tracker IMEI to a vehicle. Providers push to <code class="bg-slate-100 px-1 rounded">/api/gps/webhook</code></p>
      <div class="grid sm:grid-cols-3 gap-3">
        <input id="g-imei" placeholder="IMEI / device ID" class="border rounded-lg px-3 py-2 text-sm">
        <select id="g-provider" class="border rounded-lg px-3 py-2 text-sm">
          <option value="generic">Generic / any GPS</option>
          <option value="traccar">Traccar</option>
          <option value="keeptrack">KeepTrack / local TZ</option>
        </select>
        <input id="g-label" placeholder="Label (optional)" class="border rounded-lg px-3 py-2 text-sm">
      </div>
      <button onclick="saveGpsDevice()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save device</button>
    </div>
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Devices</div><div class="text-2xl font-bold mt-1">${devices.length || positions.length}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Online (&lt;15 min)</div><div class="text-2xl font-bold mt-1 text-emerald-600">${online}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Moving</div><div class="text-2xl font-bold mt-1">${positions.filter(p=>p.status==='moving').length}</div></div>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <div class="px-5 py-4 border-b flex justify-between items-center">
        <h3 class="font-semibold">Live positions</h3>
        <span class="text-xs text-emerald-600 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> GPS</span>
      </div>
      <div class="bg-slate-100 h-56 flex items-center justify-center relative">
        <div class="text-center z-10">
          <i data-lucide="map" class="w-10 h-10 text-brand-500 mx-auto mb-2"></i>
          <p class="text-sm font-medium text-slate-700">Map canvas ready</p>
          <p class="text-xs text-slate-500">Connect Mapbox/Leaflet + GPS webhook for live map</p>
        </div>
        ${positions.map((p,i) => p.lat ? `<div class="absolute" style="top:${30+i*12}%;left:${25+i*15}%">
          <div class="w-3 h-3 rounded-full ${p.online?'bg-emerald-500 ring-4 ring-emerald-200':'bg-slate-400'} "></div>
          <span class="text-[10px] bg-white px-1 rounded shadow">${p.plate||p.imei}</span>
        </div>` : '').join('')}
      </div>
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Vehicle / IMEI</th><th class="py-3">Provider</th><th class="py-3">Coords</th><th class="py-3">Speed</th><th class="py-3">Status</th>
        </tr></thead>
        <tbody class="divide-y">
          ${(positions.length?positions:[{plate:'No devices',status:'no_fix'}]).map(p => `<tr>
            <td class="px-5 py-3 font-medium">${p.plate||p.imei||'—'}</td>
            <td class="py-3 text-slate-500">${p.provider||'—'}</td>
            <td class="py-3 text-xs font-mono">${p.lat!=null?Number(p.lat).toFixed(4)+', '+Number(p.lng).toFixed(4):'—'}</td>
            <td class="py-3">${p.speed!=null?p.speed+' km/h':'—'}</td>
            <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${p.status==='moving'?'bg-emerald-50 text-emerald-700':p.online?'bg-blue-50 text-blue-700':'bg-slate-100'}">${p.status||'—'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}
async function saveGpsDevice() {
  try {
    await api('/api/gps/devices', { method:'POST', body: JSON.stringify({
      imei: document.getElementById('g-imei').value,
      provider: document.getElementById('g-provider').value,
      label: document.getElementById('g-label').value
    })});
    showPage('tracking');
  } catch(e) { alert(e.message); }
}

async function renderFinance() {
  const [summary, { loans }, { invoices }, expData] = await Promise.all([
    api('/api/finance/summary'),
    api('/api/loans'),
    api('/api/invoices'),
    api('/api/expenses').catch(() => ({ expenses: [], categories: [] }))
  ]);
  const opExpenses = expData.expenses || [];
  const expCats = expData.categories || ['office_rent','yard_rent','security','salaries','utilities','insurance','other'];
  const pnl = summary.pnl || {};
  const pay = summary.payables || {};
  const recv = summary.receivables || {};
  const alerts = summary.alerts || [];

  return `
  <div class="page-enter space-y-6">
    ${alerts.length ? `<div class="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div class="font-semibold text-amber-900 mb-2">Due / overdue alerts</div>
      <ul class="space-y-1 text-sm text-amber-800">
        ${alerts.slice(0,8).map(a => `<li class="flex gap-2"><span class="text-xs px-1.5 py-0.5 rounded ${a.severity==='high'?'bg-red-100 text-red-700':'bg-amber-100'}">${a.severity}</span> ${a.message}</li>`).join('')}
      </ul>
    </div>` : ''}

    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Revenue (collected)</div><div class="text-2xl font-bold mt-1 text-emerald-600">TZS ${fmt(pnl.revenue_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Expenses</div><div class="text-2xl font-bold mt-1">TZS ${fmt(pnl.expenses_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Debt to suppliers</div><div class="text-2xl font-bold mt-1 text-red-600">TZS ${fmt(pay.total_tzs||0)}</div>
        <div class="text-xs text-slate-500 mt-1">Fuel ${fmt(pay.fuel_loan_tzs||0)} · Parts ${fmt(pay.parts_loan_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Debt from clients</div><div class="text-2xl font-bold mt-1 text-brand-700">TZS ${fmt(recv.total_tzs||0)}</div>
        <div class="text-xs text-slate-500 mt-1">${recv.overdue_count||0} overdue</div></div>
    </div>

    <div class="grid lg:grid-cols-2 gap-5">
      <div class="bg-white rounded-xl border overflow-hidden">
        <div class="px-5 py-4 border-b flex justify-between items-center">
          <div>
            <h3 class="font-semibold">Supplier loans (fuel & parts)</h3>
            <p class="text-xs text-slate-500">Credit from fuel stations / spare shops — repay by due date</p>
          </div>
          <button onclick="document.getElementById('loan-form').classList.toggle('hidden')" class="text-sm text-brand-600 font-medium">+ Loan</button>
        </div>
        <div id="loan-form" class="hidden p-4 border-b bg-slate-50 space-y-2">
          <div class="grid sm:grid-cols-2 gap-2">
            <select id="loan-type" class="border rounded-lg px-3 py-2 text-sm"><option value="fuel">Fuel loan</option><option value="parts">Spare parts loan</option></select>
            <input id="loan-supplier" placeholder="Supplier name" class="border rounded-lg px-3 py-2 text-sm">
            <input id="loan-amount" type="number" placeholder="Amount TZS" class="border rounded-lg px-3 py-2 text-sm">
            <input id="loan-days" type="number" placeholder="Term days (e.g. 14)" value="14" class="border rounded-lg px-3 py-2 text-sm">
            <input id="loan-desc" placeholder="Description" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
          </div>
          <button onclick="saveLoan()" class="bg-brand-600 text-white px-3 py-1.5 rounded-lg text-sm">Save loan</button>
        </div>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
            <th class="px-4 py-2">Type</th><th class="py-2">Supplier</th><th class="py-2">Balance</th><th class="py-2">Due</th><th class="py-2">Status</th><th class="py-2"></th>
          </tr></thead>
          <tbody class="divide-y">
            ${loans.map(l => `<tr>
              <td class="px-4 py-2"><span class="text-xs px-2 py-0.5 rounded ${l.type==='fuel'?'bg-orange-50 text-orange-700':'bg-violet-50 text-violet-700'}">${l.type}</span></td>
              <td class="py-2">${l.supplier_name||'—'}</td>
              <td class="py-2 font-medium">TZS ${fmt(l.balance_tzs||0)}</td>
              <td class="py-2 text-xs">${l.due_date||'—'}</td>
              <td class="py-2"><span class="text-xs px-2 py-0.5 rounded ${l.status==='overdue'?'bg-red-50 text-red-700':l.status==='paid'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}">${l.status}</span></td>
              <td class="py-2 pr-3">${l.status!=='paid'?`<button onclick="payLoanAmt('${l.id}')" class="text-xs text-brand-600">Pay</button>`:''}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">No supplier loans</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="bg-white rounded-xl border overflow-hidden">
        <div class="px-5 py-4 border-b flex justify-between items-center">
          <div>
            <h3 class="font-semibold">Client cargo payments</h3>
            <p class="text-xs text-slate-500">Advance · on delivery · credit (N days)</p>
          </div>
          <button onclick="document.getElementById('inv-form').classList.toggle('hidden')" class="text-sm text-brand-600 font-medium">+ Invoice</button>
        </div>
        <div id="inv-form" class="hidden p-4 border-b bg-slate-50 space-y-2">
          <div class="grid sm:grid-cols-2 gap-2">
            <input id="inv-client" placeholder="Client name" class="border rounded-lg px-3 py-2 text-sm">
            <input id="inv-total" type="number" placeholder="Total TZS" class="border rounded-lg px-3 py-2 text-sm">
            <input id="inv-advance" type="number" placeholder="Advance paid TZS" class="border rounded-lg px-3 py-2 text-sm">
            <select id="inv-terms" class="border rounded-lg px-3 py-2 text-sm">
              <option value="advance">Full advance</option>
              <option value="on_delivery">Pay on delivery</option>
              <option value="credit_days">Credit (days after)</option>
            </select>
            <input id="inv-credit" type="number" placeholder="Credit days" value="14" class="border rounded-lg px-3 py-2 text-sm">
            <input id="inv-route" placeholder="Origin → Destination" class="border rounded-lg px-3 py-2 text-sm">
          </div>
          <button onclick="saveInvoice()" class="bg-brand-600 text-white px-3 py-1.5 rounded-lg text-sm">Save invoice</button>
        </div>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
            <th class="px-4 py-2">Invoice</th><th class="py-2">Client</th><th class="py-2">Balance</th><th class="py-2">Terms</th><th class="py-2">Due</th><th class="py-2">Status</th><th class="py-2"></th>
          </tr></thead>
          <tbody class="divide-y">
            ${invoices.map(i => `<tr>
              <td class="px-4 py-2 font-mono text-xs">${i.invoice_no}</td>
              <td class="py-2">${i.client_name||'—'}</td>
              <td class="py-2 font-medium">TZS ${fmt(i.balance_tzs||0)}</td>
              <td class="py-2 text-xs">${i.payment_terms}${i.credit_days?` (${i.credit_days}d)`:''}</td>
              <td class="py-2 text-xs">${i.due_date||'—'}</td>
              <td class="py-2"><span class="text-xs px-2 py-0.5 rounded ${i.status==='overdue'?'bg-red-50 text-red-700':i.status==='paid'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}">${i.status}</span></td>
              <td class="py-2 pr-3"><button onclick="printInvoice('${i.id}')" class="text-xs text-slate-600 mr-2">Print</button>${i.status!=='paid'?`<button onclick="payInvoiceAmt('${i.id}')" class="text-xs text-brand-600">Receive</button>`:''}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">No invoices</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-white rounded-xl border p-5">
      <h3 class="font-semibold mb-3">P&amp;L snapshot</h3>
      <div class="grid sm:grid-cols-4 gap-4 text-sm">
        <div><div class="text-slate-500">Revenue</div><div class="font-bold text-lg">TZS ${fmt(pnl.revenue_tzs||0)}</div></div>
        <div><div class="text-slate-500">Fuel cost</div><div class="font-bold text-lg">TZS ${fmt(pnl.fuel_cost_tzs||0)}</div></div>
        <div><div class="text-slate-500">Maintenance</div><div class="font-bold text-lg">TZS ${fmt(pnl.maintenance_cost_tzs||0)}</div></div>
        <div><div class="text-slate-500">Net</div><div class="font-bold text-lg ${ (pnl.net_tzs||0) >= 0 ? 'text-emerald-600':'text-red-600'}">TZS ${fmt(pnl.net_tzs||0)}</div></div>
      </div>
    
    <div class="bg-white rounded-xl border overflow-hidden">
      <div class="px-5 py-4 border-b flex justify-between items-center">
        <div>
          <h3 class="font-semibold">Operating expenses</h3>
          <p class="text-xs text-slate-500">Office rent, yard, security, salaries, utilities…</p>
        </div>
        <button onclick="document.getElementById('exp-form').classList.toggle('hidden')" class="text-sm text-brand-600 font-medium">+ Expense</button>
      </div>
      <div id="exp-form" class="hidden p-4 border-b bg-slate-50 space-y-2">
        <div class="grid sm:grid-cols-3 gap-2">
          <select id="ex-cat" class="border rounded-lg px-3 py-2 text-sm">
            ${expCats.map(c => `<option value="${c}">${c.replace(/_/g,' ')}</option>`).join('')}
          </select>
          <input id="ex-desc" placeholder="Description" class="border rounded-lg px-3 py-2 text-sm">
          <input id="ex-amt" type="number" placeholder="Amount TZS" class="border rounded-lg px-3 py-2 text-sm">
          <input id="ex-date" type="date" class="border rounded-lg px-3 py-2 text-sm">
          <input id="ex-vendor" placeholder="Vendor / payee" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
        </div>
        <button onclick="saveExpense()" class="bg-brand-600 text-white px-3 py-1.5 rounded-lg text-sm">Save expense</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-4 py-2">Date</th><th class="py-2">Category</th><th class="py-2">Description</th><th class="py-2">Amount</th><th class="py-2"></th>
        </tr></thead>
        <tbody class="divide-y">
          ${opExpenses.slice(0,20).map(e => `<tr>
            <td class="px-4 py-2">${e.expense_date||'—'}</td>
            <td class="py-2"><span class="text-xs px-2 py-0.5 rounded bg-slate-100">${(e.category||'').replace(/_/g,' ')}</span></td>
            <td class="py-2">${e.description||e.vendor||'—'}</td>
            <td class="py-2 font-medium">TZS ${fmt(e.amount_tzs||0)}</td>
            <td class="py-2 pr-3"><button onclick="removeExpense('${e.id}')" class="text-xs text-red-500">Del</button></td>
          </tr>`).join('') || '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">No operating expenses yet</td></tr>'}
        </tbody>
      </table>
    </div>
</div>
  </div>`;
}
async function saveLoan() {
  try {
    await api('/api/loans', { method:'POST', body: JSON.stringify({
      type: document.getElementById('loan-type').value,
      supplier_name: document.getElementById('loan-supplier').value,
      amount_tzs: +document.getElementById('loan-amount').value,
      term_days: +document.getElementById('loan-days').value || 14,
      description: document.getElementById('loan-desc').value
    })});
    showPage('finance');
  } catch(e) { alert(e.message); }
}
async function payLoanAmt(id) {
  const amt = prompt('Amount paid to supplier (TZS)?');
  if (!amt) return;
  await api('/api/loans/'+id+'/pay', { method:'POST', body: JSON.stringify({ amount: +amt }) });
  showPage('finance');
}
async function saveInvoice() {
  try {
    const route = (document.getElementById('inv-route').value||'').split('→').map(s=>s.trim());
    await api('/api/invoices', { method:'POST', body: JSON.stringify({
      client_name: document.getElementById('inv-client').value,
      total_tzs: +document.getElementById('inv-total').value,
      advance_tzs: +document.getElementById('inv-advance').value || 0,
      payment_terms: document.getElementById('inv-terms').value,
      credit_days: +document.getElementById('inv-credit').value || 0,
      origin: route[0]||'',
      destination: route[1]||route[0]||''
    })});
    showPage('finance');
  } catch(e) { alert(e.message); }
}
async function payInvoiceAmt(id) {
  const amt = prompt('Amount received from client (TZS)?');
  if (!amt) return;
  await api('/api/invoices/'+id+'/pay', { method:'POST', body: JSON.stringify({ amount: +amt }) });
  showPage('finance');
}


async function renderInventory() {
  const { parts } = await api('/api/inventory');
  const low = parts.filter(x => x.stock <= x.min_stock).length;
  return `
  <div class="page-enter space-y-5">
    <div class="flex justify-between items-center flex-wrap gap-3">
      <p class="text-sm text-slate-500">${parts.length} part types · <span class="${low?'text-red-600 font-medium':''}">${low} low stock</span></p>
      <button onclick="document.getElementById('inv-part-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Add part
      </button>
    </div>
    <div id="inv-part-form" class="hidden bg-white rounded-xl border p-5 space-y-3">
      <h3 class="font-semibold">New inventory item</h3>
      <div class="grid sm:grid-cols-3 gap-3">
        <input id="ip-sku" placeholder="SKU" class="border rounded-lg px-3 py-2 text-sm">
        <input id="ip-name" placeholder="Part name *" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
        <select id="ip-cat" class="border rounded-lg px-3 py-2 text-sm">
          <option value="oil">Engine oil</option><option value="filter">Filter</option>
          <option value="tyre">Tyre</option><option value="brake">Brake</option>
          <option value="battery">Battery</option><option value="general">General</option>
        </select>
        <input id="ip-stock" type="number" placeholder="Stock qty" class="border rounded-lg px-3 py-2 text-sm">
        <input id="ip-min" type="number" placeholder="Min stock" class="border rounded-lg px-3 py-2 text-sm">
        <input id="ip-unit" placeholder="Unit (pcs, drums…)" value="pcs" class="border rounded-lg px-3 py-2 text-sm">
        <input id="ip-cost" type="number" placeholder="Unit cost TZS" class="border rounded-lg px-3 py-2 text-sm">
        <input id="ip-supplier" placeholder="Supplier" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
      </div>
      <button onclick="saveInventoryPart()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save part</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">SKU</th><th class="py-3">Part</th><th class="py-3">Stock</th><th class="py-3">Min</th><th class="py-3">Unit cost</th><th class="py-3">Status</th><th class="py-3"></th>
        </tr></thead>
        <tbody class="divide-y">
          ${parts.map(x => `<tr>
            <td class="px-5 py-3 font-mono text-xs">${x.sku}</td>
            <td class="py-3 font-medium">${x.name}<div class="text-xs text-slate-400">${x.category||''}</div></td>
            <td class="py-3">${x.stock} ${x.unit||''}</td>
            <td class="py-3 text-slate-500">${x.min_stock}</td>
            <td class="py-3">TZS ${fmt(x.unit_cost_tzs||0)}</td>
            <td class="py-3">${x.stock<=x.min_stock?'<span class="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700">Low stock</span>':'<span class="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">OK</span>'}</td>
            <td class="py-3 pr-3 space-x-2">
              <button onclick="adjustPart('${x.id}',1)" class="text-xs text-brand-600">+1</button>
              <button onclick="adjustPart('${x.id}',-1)" class="text-xs text-slate-500">-1</button>
              <button onclick="removePart('${x.id}')" class="text-xs text-red-500">Del</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400">No parts — click Add part</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}
async function saveInventoryPart() {
  try {
    await api('/api/inventory', { method:'POST', body: JSON.stringify({
      sku: document.getElementById('ip-sku').value,
      name: document.getElementById('ip-name').value,
      category: document.getElementById('ip-cat').value,
      stock: +document.getElementById('ip-stock').value,
      min_stock: +document.getElementById('ip-min').value,
      unit: document.getElementById('ip-unit').value,
      unit_cost_tzs: +document.getElementById('ip-cost').value,
      supplier_name: document.getElementById('ip-supplier').value
    })});
    showPage('inventory');
  } catch(e) { alert(e.message); }
}
async function adjustPart(id, delta) {
  await api('/api/inventory/'+id+'/adjust', { method:'POST', body: JSON.stringify({ delta, reason: delta>0?'stock in':'stock out' }) });
  showPage('inventory');
}
async function removePart(id) {
  if (!confirm('Delete this part?')) return;
  await api('/api/inventory/'+id, { method:'DELETE' });
  showPage('inventory');
}

async function renderReports() {
  const r = await api('/api/reports/summary');
  const pnl = r.pnl || {};
  const fleet = r.fleet || {};
  return `
  <div class="page-enter space-y-6">
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-xl border p-5">
        <div class="text-xs text-slate-500 font-medium">Revenue</div>
        <div class="text-2xl font-bold mt-1 text-emerald-600">TZS ${fmt(pnl.revenue_tzs||0)}</div>
      </div>
      <div class="bg-white rounded-xl border p-5">
        <div class="text-xs text-slate-500 font-medium">Total expenses</div>
        <div class="text-2xl font-bold mt-1">TZS ${fmt(pnl.expenses_tzs||0)}</div>
        <div class="text-xs text-slate-400 mt-1">Fuel ${fmt(pnl.fuel_cost_tzs||0)} · Maint ${fmt(pnl.maintenance_cost_tzs||0)} · Ops ${fmt(pnl.operating_expenses_tzs||0)}</div>
      </div>
      <div class="bg-white rounded-xl border p-5">
        <div class="text-xs text-slate-500 font-medium">Net P&amp;L</div>
        <div class="text-2xl font-bold mt-1 ${(pnl.net_tzs||0)>=0?'text-emerald-600':'text-red-600'}">TZS ${fmt(pnl.net_tzs||0)}</div>
      </div>
      <div class="bg-white rounded-xl border p-5">
        <div class="text-xs text-slate-500 font-medium">Fleet utilisation</div>
        <div class="text-2xl font-bold mt-1">${fleet.utilization_pct||0}%</div>
        <div class="text-xs text-slate-400 mt-1">${fleet.on_route||0} on route / ${fleet.total||0} vehicles</div>
      </div>
    </div>
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Debt to suppliers</div><div class="text-xl font-bold mt-1 text-red-600">TZS ${fmt((r.payables||{}).total_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Debt from clients</div><div class="text-xl font-bold mt-1 text-brand-700">TZS ${fmt((r.receivables||{}).total_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Maint due · Low stock</div><div class="text-xl font-bold mt-1">${r.maintenance_due||0} · ${r.low_stock_parts||0}</div></div>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${[['Fleet utilisation', fleet.utilization_pct+'% on route','bar-chart-3'],
         ['Fuel cost','TZS '+fmt(pnl.fuel_cost_tzs||0),'fuel'],
         ['Trip count', String(r.trips_count||0),'route'],
         ['Maintenance due', String(r.maintenance_due||0)+' items','wrench'],
         ['Receivables','TZS '+fmt((r.receivables||{}).total_tzs||0),'users'],
         ['P&L net','TZS '+fmt(pnl.net_tzs||0),'wallet']].map(([t,d,i]) => `
        <div class="bg-white rounded-xl border p-5">
          <div class="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center mb-3"><i data-lucide="${i}" class="w-5 h-5 text-brand-600"></i></div>
          <div class="font-semibold">${t}</div>
          <div class="text-lg font-bold text-slate-800 mt-1">${d}</div>
        </div>`).join('')}
    </div>
    ${(r.alerts||[]).length ? `<div class="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div class="font-semibold text-amber-900 mb-2">Alerts</div>
      <ul class="text-sm text-amber-800 space-y-1">${r.alerts.slice(0,6).map(a=>`<li>${a.message}</li>`).join('')}</ul>
    </div>` : ''}
  </div>`;
}


async function renderTeam() {
  const { users, presets } = await api('/api/team');
  const presetOpts = Object.entries(presets || {}).filter(([k]) => k !== 'fleet_manager').map(([k,v]) =>
    `<option value="${k}">${v.label}</option>`).join('');
  return `
  <div class="page-enter space-y-5">
    <div class="flex justify-between items-center">
      <div>
        <p class="text-sm text-slate-500">${users.length} user(s) in your company</p>
        <p class="text-xs text-slate-400 mt-0.5">Fleet manager can add staff and set what they can access</p>
      </div>
      <button onclick="document.getElementById('team-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="user-plus" class="w-4 h-4"></i> Add user
      </button>
    </div>
    <div id="team-form" class="hidden bg-white rounded-xl border p-5 space-y-3">
      <h3 class="font-semibold">New company user</h3>
      <div class="grid sm:grid-cols-2 gap-3">
        <input id="tu-name" placeholder="Full name" class="border rounded-lg px-3 py-2 text-sm">
        <input id="tu-email" type="email" placeholder="Email" class="border rounded-lg px-3 py-2 text-sm">
        <input id="tu-phone" placeholder="Phone" class="border rounded-lg px-3 py-2 text-sm">
        <input id="tu-password" type="password" placeholder="Password (min 6)" class="border rounded-lg px-3 py-2 text-sm">
        <select id="tu-role" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
          ${presetOpts}
        </select>
      </div>
      <p class="text-xs text-slate-500">Roles: Dispatcher (trips/GPS) · Accountant (finance/fuel) · Workshop (maintenance/parts) · Viewer (read-only)</p>
      <button onclick="saveTeamUser()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Create user</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Name</th><th class="py-3">Email</th><th class="py-3">Role</th><th class="py-3">Access</th><th class="py-3">Status</th><th class="py-3"></th>
        </tr></thead>
        <tbody class="divide-y">
          ${users.map(u => {
            const perms = u.permissions || {};
            const keys = Object.keys(perms).filter(k => perms[k]).slice(0,6).join(', ');
            return `<tr>
              <td class="px-5 py-3 font-medium">${u.name}</td>
              <td class="py-3">${u.email}</td>
              <td class="py-3"><span class="text-xs px-2 py-0.5 rounded bg-slate-100">${(u.role||'').replace(/_/g,' ')}</span></td>
              <td class="py-3 text-xs text-slate-500 max-w-xs truncate">${keys || '—'}</td>
              <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${u.active!==false?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}">${u.active!==false?'Active':'Disabled'}</span></td>
              <td class="py-3 pr-4">${u.role==='fleet_manager'?'':`<button onclick="removeTeamUser('${u.id}')" class="text-xs text-red-500">Remove</button>`}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="6" class="px-5 py-8 text-center text-slate-400">No users</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}
async function saveTeamUser() {
  try {
    const res = await api('/api/team', { method:'POST', body: JSON.stringify({
      name: document.getElementById('tu-name').value,
      email: document.getElementById('tu-email').value,
      phone: document.getElementById('tu-phone').value,
      password: document.getElementById('tu-password').value,
      role: document.getElementById('tu-role').value
    })});
    alert('User created' + (res.user?.temp_password ? '. Temp password: ' + res.user.temp_password : ''));
    showPage('team');
  } catch(e) { alert(e.message); }
}
async function removeTeamUser(id) {
  if (!confirm('Remove this user from the company?')) return;
  await api('/api/team/'+id, { method:'DELETE' });
  showPage('team');
}



async function loadExpensesBlock() {
  try {
    const { expenses, categories } = await api('/api/expenses');
    return { expenses, categories };
  } catch { return { expenses: [], categories: [] }; }
}
function printInvoice(invId) {
  // find invoice data from last finance page - refetch
  api('/api/invoices').then(({ invoices }) => {
    const i = invoices.find(x => x.id === invId);
    if (!i) return alert('Invoice not found');
    const w = window.open('', '_blank', 'width=800,height=900');
    w.document.write(`<!DOCTYPE html><html><head><title>${i.invoice_no}</title>
      <style>body{font-family:system-ui;padding:40px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:24px}
      td,th{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}.brand{font-size:22px;font-weight:700;color:#006fc7}
      .muted{color:#64748b;font-size:13px}.total{font-size:18px;font-weight:700}@media print{button{display:none}}</style></head><body>
      <div class="brand">MlimaniFleet</div>
      <div class="muted">Tax invoice / cargo payment</div>
      <h1 style="margin-top:24px">${i.invoice_no}</h1>
      <p><strong>Client:</strong> ${i.client_name||'—'} ${i.client_phone?'· '+i.client_phone:''}</p>
      <p><strong>Route:</strong> ${i.origin||''} → ${i.destination||''}</p>
      <p><strong>Date:</strong> ${i.invoice_date||''} · <strong>Due:</strong> ${i.due_date||''}</p>
      <p><strong>Terms:</strong> ${i.payment_terms}${i.credit_days?' ('+i.credit_days+' days)':''}</p>
      <table><tr><th>Description</th><th>Amount (TZS)</th></tr>
      <tr><td>${i.description||'Cargo transport'}</td><td>${Number(i.total_tzs||0).toLocaleString()}</td></tr>
      <tr><td>Advance paid</td><td>${Number(i.advance_tzs||0).toLocaleString()}</td></tr>
      <tr><td><strong>Balance due</strong></td><td class="total">${Number(i.balance_tzs||0).toLocaleString()}</td></tr>
      </table>
      <p class="muted" style="margin-top:32px">Status: ${i.status}</p>
      <button onclick="window.print()" style="margin-top:24px;padding:10px 20px;background:#006fc7;color:#fff;border:0;border-radius:8px;cursor:pointer">Print</button>
      </body></html>`);
    w.document.close();
  });
}
async function saveExpense() {
  try {
    await api('/api/expenses', { method:'POST', body: JSON.stringify({
      category: document.getElementById('ex-cat').value,
      description: document.getElementById('ex-desc').value,
      amount_tzs: +document.getElementById('ex-amt').value,
      expense_date: document.getElementById('ex-date').value,
      vendor: document.getElementById('ex-vendor').value
    })});
    showPage('finance');
  } catch(e) { alert(e.message); }
}
async function removeExpense(id) {
  if (!confirm('Delete expense?')) return;
  await api('/api/expenses/'+id, { method:'DELETE' });
  showPage('finance');
}


// Boot
if (token) bootApp();
else {
  document.getElementById('auth-screen').classList.remove('hidden');
  lucide.createIcons();
}
