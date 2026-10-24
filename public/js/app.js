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
  if (!res.ok) {
    if (res.status === 402 || data.code === 'SUBSCRIPTION_LOCKED') {
      window.subscriptionState = data.subscription || { locked: true, reason: data.error };
      if (typeof showPage === 'function') setTimeout(() => showPage('billing'), 50);
    }
    throw new Error(data.error || 'Request failed');
  }
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
  if (err) err.classList.add('hidden');
  try {
    const identityEl = document.getElementById('login-identity') || document.getElementById('login-email');
    const identity = (identityEl?.value || '').trim();
    const password = document.getElementById('login-password')?.value || '';
    if (!identity) throw new Error('Enter email or mobile number');
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identity, email: identity, phone: identity, password })
    });
    token = data.token;
    localStorage.setItem('mf_token', token);
    currentUser = data.user;
    await bootApp();
  } catch (ex) {
    if (err) { err.textContent = ex.message; err.classList.remove('hidden'); }
    else alert(ex.message);
  }
  return false;
}

async function doRegister(e) {
  e.preventDefault();
  const err = document.getElementById('reg-error');
  if (err) err.classList.add('hidden');
  try {
    const phone = (document.getElementById('reg-phone')?.value || '').trim();
    const email = (document.getElementById('reg-email')?.value || '').trim();
    if (!phone && !email) throw new Error('Enter mobile number or email');
    if (!(document.getElementById('reg-company')?.value || '').trim()) throw new Error('Company name is required');
    if ((document.getElementById('reg-password')?.value || '').length < 6) throw new Error('Password must be at least 6 characters');
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        company_name: document.getElementById('reg-company').value.trim(),
        name: (document.getElementById('reg-name')?.value || '').trim(),
        email,
        phone,
        planned_vehicles: +(document.getElementById('reg-vehicles')?.value || 1),
        password: document.getElementById('reg-password').value
      })
    });
    token = data.token;
    localStorage.setItem('mf_token', token);
    currentUser = data.user;
    await bootApp();
  } catch (ex) {
    if (err) { err.textContent = ex.message; err.classList.remove('hidden'); }
    else alert(ex.message);
  }
  return false;
}

function logout() {
  token = null;
  try { localStorage.removeItem('mf_token'); } catch (_) {}
  currentUser = null;
  currentCompany = null;
  const app = document.getElementById('app-shell');
  const auth = document.getElementById('auth-screen');
  if (app) { app.classList.remove('is-open'); app.classList.add('hidden'); app.style.display = 'none'; }
  if (auth) { auth.classList.remove('hidden'); auth.classList.remove('is-hidden'); auth.style.display = ''; }
  if (typeof showLogin === 'function') showLogin();
}

async function bootApp() {
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    currentCompany = me.company;
    window.subscriptionState = me.subscription || { locked: false, ok: true };
  } catch (e) {
    console.warn('auth/me failed', e);
    logout();
    return;
  }
  try {
    const authEl = document.getElementById('auth-screen');
    const appEl = document.getElementById('app-shell');
    if (authEl) { authEl.classList.add('hidden'); authEl.classList.add('is-hidden'); }
    if (appEl) { appEl.classList.add('is-open'); appEl.classList.remove('hidden'); appEl.style.display = 'flex'; }

    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = currentUser.name || currentUser.email || 'User';
    const isAdmin = currentUser.role === 'platform_admin';
    const isManager = currentUser.role === 'fleet_manager' || (currentUser.permissions && currentUser.permissions.team);
    const roleEl = document.getElementById('user-role');
    if (roleEl) roleEl.textContent = isAdmin ? 'Platform Admin' : (currentUser.role === 'fleet_manager' ? 'Fleet Manager' : (currentUser.role || 'User').replace(/_/g,' '));
    const av = document.getElementById('user-avatar');
    if (av) av.textContent = (currentUser.name || currentUser.email || '?').slice(0, 2).toUpperCase();

    const perms = currentUser.permissions || (
      currentUser.role === 'fleet_manager'
        ? { vehicles:true,drivers:true,trips:true,maintenance:true,fuel:true,finance:true,gps:true,inventory:true,reports:true,billing:true,team:true }
        : currentUser.role === 'platform_admin' ? {} : {}
    );
    window.currentPerms = perms;

    if (isAdmin) {
      document.getElementById('admin-nav')?.classList.remove('hidden');
      document.getElementById('nav-subscription')?.classList.add('hidden');
      document.getElementById('btn-subscription')?.classList.add('hidden');
      document.getElementById('nav-team')?.classList.add('hidden');
      document.getElementById('sub-badge')?.classList.add('hidden');
    } else {
      document.getElementById('admin-nav')?.classList.add('hidden');
      if (perms.billing !== false) {
        document.getElementById('nav-subscription')?.classList.remove('hidden');
        document.getElementById('btn-subscription')?.classList.remove('hidden');
      } else {
        document.getElementById('nav-subscription')?.classList.add('hidden');
        document.getElementById('btn-subscription')?.classList.add('hidden');
      }
      if (isManager || perms.team) document.getElementById('nav-team')?.classList.remove('hidden');
      else document.getElementById('nav-team')?.classList.add('hidden');

      const navMap = {
        vehicles: 'vehicles', drivers: 'drivers', trips: 'trips', maintenance: 'maintenance',
        fuel: 'fuel', tracking: 'gps', inventory: 'inventory', finance: 'finance', reports: 'reports'
      };
      document.querySelectorAll('.nav-item[data-page]').forEach(el => {
        const page = el.dataset.page;
        if (['dashboard','team','billing','admin-pricing','admin-companies','admin-home','admin-payments','settings'].includes(page)) return;
        const key = navMap[page];
        if (key && perms[key] === false) el.classList.add('hidden');
        else if (key) el.classList.remove('hidden');
      });

      const badge = document.getElementById('sub-badge');
      if (badge && currentCompany) {
        badge.classList.remove('hidden');
        const st = currentCompany.subscription_status || 'trial';
        badge.textContent = st === 'active' ? 'Active plan' : st === 'trial' ? 'Trial' : st;
        badge.className = 'text-xs px-2.5 py-1 rounded-full font-medium ' +
          (st === 'active' ? 'bg-emerald-50 text-emerald-700' : st === 'trial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700');
      }
    }
    bindNav();
    
    // Subscription lock banner + nav restrict for fleet users
    try {
      const sub = window.subscriptionState || {};
      let banner = document.getElementById('sub-lock-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'sub-lock-banner';
        const mainCol = document.querySelector('#app-shell > div.flex-1') || document.getElementById('app-shell');
        if (mainCol) mainCol.insertBefore(banner, mainCol.firstChild);
      }
      if (sub.locked && currentUser.role !== 'platform_admin') {
        banner.className = 'bg-red-600 text-white px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2 shrink-0';
        banner.innerHTML = `<span><strong>Access limited:</strong> ${sub.reason || 'Payment required.'}</span>
          <button onclick="showPage('billing')" class="bg-white text-red-700 font-semibold px-3 py-1.5 rounded-lg text-xs">Pay / Subscription</button>`;
        banner.style.display = 'flex';
        document.querySelectorAll('.nav-item[data-page]').forEach(el => {
          const pg = el.dataset.page;
          if (!['billing','settings'].includes(pg)) {
            el.classList.add('opacity-40','pointer-events-none');
            el.title = 'Pay subscription to unlock';
          }
        });
      } else if (banner) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        document.querySelectorAll('.nav-item[data-page]').forEach(el => {
          el.classList.remove('opacity-40','pointer-events-none');
          el.title = '';
        });
      }
    } catch (_) {}

    await showPage(currentUser.role === 'platform_admin' ? 'admin-home' : (window.subscriptionState && window.subscriptionState.locked ? 'billing' : 'dashboard'));
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('bootApp UI error', err);
    // Keep app visible with error rather than blank screen
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = '<div class="p-6 bg-red-50 text-red-700 rounded-xl">Dashboard error: ' + (err.message || err) + '. <button class="underline" onclick="logout()">Back to login</button></div>';
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('auth-screen')?.classList.add('is-hidden');
    const _sh = document.getElementById('app-shell');
    if (_sh) { _sh.classList.add('is-open'); _sh.style.display = 'flex'; }
  }
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
  inventory: ['Parts Warehouse', 'Store receive, issue to vehicles, stock levels'],
  finance: ['Finance & Billing', 'Revenue, invoices and expenses'],
  reports: ['Reports', 'Operational and financial insights'],
  team: ['Team', 'Company users and permissions'],
  billing: ['Subscription', 'Plans and mobile money payments'],
  'admin-home': ['Owner dashboard', 'Clients, revenue and platform health'],
  'admin-pricing': ['Pricing plans', 'Monthly SaaS rates in TZS'],
  'admin-companies': ['All clients', 'Every fleet company on the platform'],
  'admin-payments': ['Payments received', 'Subscription payments from clients'],
  'settings': ['Settings', 'Profile and password']
};

async function showPage(page) {
  // Locked companies may only open billing + settings
  if (currentUser && currentUser.role !== 'platform_admin' && window.subscriptionState && window.subscriptionState.locked) {
    if (!['billing','settings'].includes(page)) {
      page = 'billing'; // SUBSCRIPTION_LOCKED_PAGE
    }
  }
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
    else if (page === 'admin-home') main.innerHTML = await renderAdminHome();
    else if (page === 'admin-pricing') main.innerHTML = await renderAdminPricing();
    else if (page === 'admin-companies') main.innerHTML = await renderAdminCompanies();
    else if (page === 'admin-payments') main.innerHTML = await renderAdminPayments();
    else if (page === 'settings') main.innerHTML = await renderSettings();
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
    <div class="flex flex-wrap justify-between items-center gap-3">
      <div>
        <p class="text-sm text-slate-600"><span class="font-semibold text-slate-900">${vehicles.length}</span> registered
          · slot limit <span class="font-semibold">${currentCompany?.vehicle_limit ?? '—'}</span>
          ${vehicles.length >= (currentCompany?.vehicle_limit||0) ? '<span class="ml-2 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Full — pay to add more</span>' : ''}
        </p>
        <p class="text-xs text-slate-400 mt-0.5">Monthly fee after trial: TZS ${((currentCompany?.vehicle_limit||vehicles.length||1)*10000).toLocaleString()} (${currentCompany?.vehicle_limit||vehicles.length||1} × 10,000)</p>
      </div>
      <div class="flex gap-2">
        <button onclick="requestMoreVehicleSlots()" class="border border-slate-200 hover:bg-slate-50 text-sm px-4 py-2 rounded-lg font-medium">Buy more slots</button>
        <button onclick="openAddVehicle()" class="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2">
          <i data-lucide="plus" class="w-4 h-4"></i> Add vehicle
        </button>
      </div>
    </div>
    <div id="vehicle-upgrade" class="hidden bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-950">
      <strong>No free slots left.</strong> You have used all paid/trial vehicle slots.
      <div class="mt-2 flex flex-wrap gap-2">
        <button onclick="requestMoreVehicleSlots()" class="bg-brand-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Pay for extra vehicles</button>
        <button onclick="showPage('billing')" class="border border-amber-300 px-3 py-1.5 rounded-lg text-xs font-medium">Open subscription</button>
      </div>
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
  const locked = window.subscriptionState && window.subscriptionState.locked;
  const lockNote = locked ? `<div class="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm mb-4">
    <strong>Your access is limited until payment is confirmed.</strong><br>
    ${window.subscriptionState.reason || ''}
    <br><span class="text-xs mt-1 block">Pay with mobile money below, or send M-Pesa to MlimaniFleet and ask them to mark you paid.</span>
  </div>` : '';
  const tiers = (await api('/api/pricing')).tiers;
  return `
  <div class="page-enter space-y-6">
    ${lockNote}
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


async function renderAdminHome() {
  const d = await api('/api/admin/overview');
  const s = d.stats || {};
  const clients = d.clients || [];
  const delayed = d.delayed || [];
  const week = d.registered_week || [];
  const pays = (d.recent_payments || []).slice(0, 8);
  return `
  <div class="page-enter space-y-6">
    <div class="bg-gradient-to-r from-slate-900 to-brand-800 text-white rounded-2xl p-6 shadow-lg">
      <div class="text-sm text-brand-200 font-medium">Platform owner</div>
      <h2 class="text-2xl font-bold mt-1">MlimaniFleet control centre</h2>
      <p class="text-slate-300 text-sm mt-2">Clients, subscriptions, revenue and overdue billing — at a glance.</p>
      <div class="flex flex-wrap gap-2 mt-4">
        <button onclick="showPage('admin-companies')" class="bg-white/10 hover:bg-white/20 text-sm px-3 py-1.5 rounded-lg">All clients</button>
        <button onclick="showPage('admin-payments')" class="bg-white/10 hover:bg-white/20 text-sm px-3 py-1.5 rounded-lg">Payments</button>
        <button onclick="showPage('admin-pricing')" class="bg-white/10 hover:bg-white/20 text-sm px-3 py-1.5 rounded-lg">Pricing</button>
        <button onclick="showPage('settings')" class="bg-white/10 hover:bg-white/20 text-sm px-3 py-1.5 rounded-lg">Settings</button>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-2xl border p-4 shadow-sm"><div class="text-xs text-slate-500 uppercase">Clients</div><div class="text-3xl font-bold mt-1">${s.total_clients||0}</div><div class="text-xs text-slate-400 mt-1">${s.active_subscriptions||0} active · ${s.trials||0} trial</div></div>
      <div class="bg-white rounded-2xl border p-4 shadow-sm"><div class="text-xs text-slate-500 uppercase">Revenue (all)</div><div class="text-2xl font-bold mt-1 text-emerald-700">TZS ${fmt(s.revenue_all_tzs||0)}</div><div class="text-xs text-slate-400 mt-1">Week: ${fmt(s.revenue_week_tzs||0)}</div></div>
      <div class="bg-white rounded-2xl border p-4 shadow-sm"><div class="text-xs text-slate-500 uppercase">This month</div><div class="text-2xl font-bold mt-1">TZS ${fmt(s.revenue_month_tzs||0)}</div><div class="text-xs text-slate-400 mt-1">Paid subscriptions</div></div>
      <div class="bg-white rounded-2xl border p-4 shadow-sm"><div class="text-xs text-slate-500 uppercase">Delayed / overdue</div><div class="text-3xl font-bold mt-1 ${(s.delayed||0)?'text-red-600':'text-emerald-600'}">${s.delayed||0}</div><div class="text-xs text-slate-400 mt-1">Need follow-up</div></div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-slate-50 rounded-xl border p-4"><div class="text-xs text-slate-500">Registered this week</div><div class="text-2xl font-bold">${s.registered_this_week||0}</div></div>
      <div class="bg-slate-50 rounded-xl border p-4"><div class="text-xs text-slate-500">Last 30 days</div><div class="text-2xl font-bold">${s.registered_last_30_days||0}</div></div>
      <div class="bg-slate-50 rounded-xl border p-4"><div class="text-xs text-slate-500">Fleet vehicles on platform</div><div class="text-2xl font-bold">${s.total_vehicles||0}</div></div>
      <div class="bg-slate-50 rounded-xl border p-4"><div class="text-xs text-slate-500">Fleet user accounts</div><div class="text-2xl font-bold">${s.fleet_users||0}</div></div>
    </div>

    <div class="grid lg:grid-cols-2 gap-5">
      <div class="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b font-semibold text-sm flex justify-between"><span>Delayed payments / expired trials</span><span class="text-red-600">${delayed.length}</span></div>
        <ul class="divide-y max-h-64 overflow-y-auto text-sm">
          ${delayed.map(c => `<li class="px-5 py-3 flex justify-between gap-2">
            <div><div class="font-medium">${esc(c.name)}</div><div class="text-xs text-slate-400">${c.subscription_status} · next ${c.next_billing_date||c.trial_ends||'—'} · ${c.phone||c.email||''}</div></div>
            <div class="flex flex-col gap-1 items-end">
              <button onclick="adminMarkPaid('${c.id}')" class="text-xs bg-emerald-600 text-white px-2 py-1 rounded-lg font-medium">Mark paid</button>
              <button onclick="adminSetStatus('${c.id}','past_due')" class="text-xs text-amber-700 font-medium">Past due</button>
            </div>
          </li>`).join('') || '<li class="px-5 py-8 text-center text-slate-400">No delayed clients</li>'}
        </ul>
      </div>
      <div class="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b font-semibold text-sm">New clients this week</div>
        <ul class="divide-y max-h-64 overflow-y-auto text-sm">
          ${week.map(c => `<li class="px-5 py-3 flex justify-between"><span class="font-medium">${esc(c.name)}</span><span class="text-xs text-slate-400">${(c.created_at||'').slice(0,10)}</span></li>`).join('') || '<li class="px-5 py-8 text-center text-slate-400">None this week</li>'}
        </ul>
      </div>
    </div>

    <div class="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <div class="px-5 py-3 border-b font-semibold text-sm flex justify-between items-center">
        <span>Recent client payments</span>
        <button onclick="showPage('admin-payments')" class="text-brand-600 text-xs font-medium">View all</button>
      </div>
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 bg-slate-50 border-b"><th class="px-5 py-2">When</th><th class="py-2">Client</th><th class="py-2">Amount</th><th class="py-2">Gateway</th><th class="py-2">Status</th></tr></thead>
        <tbody class="divide-y">
          ${pays.map(p => `<tr>
            <td class="px-5 py-2 text-xs text-slate-500">${(p.completed_at||p.created_at||'').slice(0,16).replace('T',' ')}</td>
            <td class="py-2 font-medium">${esc(p.company_name)}</td>
            <td class="py-2 font-semibold">TZS ${fmt(p.amount||0)}</td>
            <td class="py-2 text-xs">${p.gateway||'—'}</td>
            <td class="py-2"><span class="text-xs px-2 py-0.5 rounded ${p.status==='completed'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}">${p.status}</span></td>
          </tr>`).join('') || '<tr><td colspan="5" class="px-5 py-8 text-center text-slate-400">No payments yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <div class="px-5 py-3 border-b font-semibold text-sm">All clients (snapshot)</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[640px]">
          <thead><tr class="text-left text-xs text-slate-500 bg-slate-50 border-b">
            <th class="px-5 py-2">Company</th><th class="py-2">Status</th><th class="py-2">Vehicles</th><th class="py-2">Paid total</th><th class="py-2">Next bill</th><th class="py-2">Contact</th><th class="py-2 text-right">Actions</th>
          </tr></thead>
          <tbody class="divide-y">
            ${clients.slice(0,15).map(c => `<tr class="hover:bg-slate-50">
              <td class="px-5 py-2 font-medium">${esc(c.name)}</td>
              <td class="py-2"><span class="text-xs px-2 py-0.5 rounded ${c.is_delayed?'bg-red-50 text-red-700':c.subscription_status==='active'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}">${c.subscription_status}${c.is_delayed?' · delayed':''}</span></td>
              <td class="py-2">${c.vehicle_count}</td>
              <td class="py-2">TZS ${fmt(c.total_paid_tzs||0)}</td>
              <td class="py-2 text-xs">${c.next_billing_date||c.trial_ends||'—'}</td>
              <td class="py-2 text-xs">${c.phone||c.email||'—'}</td>
              <td class="py-2 text-right whitespace-nowrap space-x-1">
                <button onclick="adminMarkPaid('${c.id}')" class="text-xs bg-emerald-600 text-white px-2 py-1 rounded-md font-medium">Mark paid</button>
                <button onclick="adminSetStatus('${c.id}','past_due')" class="text-xs text-amber-700">Past due</button>
                <button onclick="adminSuspend('${c.id}')" class="text-xs text-red-600">Suspend</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400">No clients</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

async function renderAdminPayments() {
  const d = await api('/api/admin/overview');
  const pays = d.recent_payments || [];
  const s = d.stats || {};
  return `
  <div class="page-enter space-y-5">
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="bg-white border rounded-xl p-4"><div class="text-xs text-slate-500">All time</div><div class="text-xl font-bold text-emerald-700">TZS ${fmt(s.revenue_all_tzs||0)}</div></div>
      <div class="bg-white border rounded-xl p-4"><div class="text-xs text-slate-500">This month</div><div class="text-xl font-bold">TZS ${fmt(s.revenue_month_tzs||0)}</div></div>
      <div class="bg-white border rounded-xl p-4"><div class="text-xs text-slate-500">This week</div><div class="text-xl font-bold">TZS ${fmt(s.revenue_week_tzs||0)}</div></div>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 bg-slate-50 border-b"><th class="px-5 py-3">Date</th><th class="py-3">Client</th><th class="py-3">Phone</th><th class="py-3">Amount</th><th class="py-3">Gateway</th><th class="py-3">Status</th></tr></thead>
        <tbody class="divide-y">
          ${pays.map(p => `<tr>
            <td class="px-5 py-3 text-xs text-slate-500">${(p.completed_at||p.created_at||'').slice(0,19).replace('T',' ')}</td>
            <td class="py-3 font-medium">${esc(p.company_name)}</td>
            <td class="py-3 text-xs">${p.phone||'—'}</td>
            <td class="py-3 font-semibold">TZS ${fmt(p.amount||0)}</td>
            <td class="py-3 text-xs">${p.gateway||'—'} ${p.provider||''}</td>
            <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${p.status==='completed'?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}">${p.status}</span></td>
          </tr>`).join('') || '<tr><td colspan="6" class="px-5 py-10 text-center text-slate-400">No payments recorded yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}


async function adminMarkPaid(companyId) {
  const note = prompt('Optional note (e.g. M-Pesa ref)', 'Manual M-Pesa payment') || 'Manual payment';
  const slotsStr = prompt('Vehicle slots allowed after payment (how many trucks they paid for)', '1');
  const amountStr = prompt('Amount received (TZS), optional', '');
  try {
    const body = { days: 30, note };
    if (slotsStr) body.vehicle_limit = Math.max(1, parseInt(slotsStr, 10) || 1);
    if (amountStr) body.amount_tzs = Number(amountStr.replace(/,/g, ''));
    const r = await api('/api/admin/companies/' + companyId + '/mark-paid', { method: 'POST', body: JSON.stringify(body) });
    alert(r.message || 'Marked paid');
    showPage('admin-home');
  } catch (e) { alert(e.message); }
}
async function adminSuspend(companyId) {
  if (!confirm('Suspend this company? They will be locked until you mark paid.')) return;
  try {
    await api('/api/admin/companies/' + companyId, { method: 'PATCH', body: JSON.stringify({ subscription_status: 'suspended' }) });
    showPage('admin-home');
  } catch (e) { alert(e.message); }
}

async function adminSetStatus(companyId, status) {
  try {
    await api('/api/admin/companies/' + companyId, { method: 'PATCH', body: JSON.stringify({ subscription_status: status }) });
    showPage('admin-home');
  } catch (e) { alert(e.message); }
}

async function renderSettings() {
  const me = currentUser || {};
  return `
  <div class="page-enter max-w-xl space-y-6">
    <div class="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
      <h3 class="font-semibold text-lg">Profile</h3>
      <div>
        <label class="text-sm font-medium text-slate-700">Display name</label>
        <input id="set-name" value="${esc(me.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm">
      </div>
      <div>
        <label class="text-sm font-medium text-slate-700">Mobile</label>
        <input id="set-phone" value="${esc(me.phone||'')}" placeholder="07XXXXXXXX" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm">
      </div>
      <div>
        <label class="text-sm font-medium text-slate-700">Email / login</label>
        <input value="${esc(me.email||'')}" disabled class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-500">
      </div>
      <button onclick="saveProfile()" class="bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold">Save profile</button>
    </div>

    <div class="bg-white rounded-2xl border shadow-sm p-6 space-y-4" id="fx-settings-box">
      <h3 class="font-semibold text-lg">USD exchange rate (trips)</h3>
      <p class="text-sm text-slate-500">Used when a trip is paid in USD (transit). 1 USD = ? TZS. You can still change the rate on each trip.</p>
      <div>
        <label class="text-sm font-medium text-slate-700">Default TZS per 1 USD</label>
        <input id="set-fx-rate" type="number" min="1" step="1" value="${Number(currentCompany?.usd_tzs_rate)||2600}" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm">
      </div>
      <button onclick="saveFxRate()" class="bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold">Save exchange rate</button>
    </div>

    <div class="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
      <h3 class="font-semibold text-lg">Change password</h3>
      <p class="text-sm text-slate-500">Use a strong password. You will stay signed in after changing it.</p>
      <div>
        <label class="text-sm font-medium text-slate-700">Current password</label>
        <input id="set-cur-pass" type="password" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm">
      </div>
      <div>
        <label class="text-sm font-medium text-slate-700">New password</label>
        <input id="set-new-pass" type="password" minlength="6" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm">
      </div>
      <div>
        <label class="text-sm font-medium text-slate-700">Confirm new password</label>
        <input id="set-new-pass2" type="password" minlength="6" class="mt-1 w-full border rounded-xl px-3 py-2.5 text-sm">
      </div>
      <div id="set-pass-msg" class="hidden text-sm rounded-lg px-3 py-2"></div>
      <button onclick="changePassword()" class="bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold">Update password</button>
    </div>
  </div>`;
}

async function saveProfile() {
  try {
    const data = await api('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById('set-name').value,
        phone: document.getElementById('set-phone').value
      })
    });
    currentUser = { ...currentUser, ...data.user };
    document.getElementById('user-name').textContent = currentUser.name || currentUser.email;
    alert('Profile saved');
  } catch (e) { alert(e.message); }
}

async function saveFxRate() {
  try {
    const rate = +document.getElementById('set-fx-rate').value;
    if (!rate || rate < 1) throw new Error('Enter a valid rate');
    const data = await api('/api/company/profile', { method: 'PUT', body: JSON.stringify({ usd_tzs_rate: rate }) });
    currentCompany = { ...(currentCompany || {}), ...(data.company || { usd_tzs_rate: rate }) };
    alert('Exchange rate saved: 1 USD = ' + rate.toLocaleString() + ' TZS');
  } catch (e) { alert(e.message); }
}
async function changePassword() {
  const msg = document.getElementById('set-pass-msg');
  const a = document.getElementById('set-new-pass').value;
  const b = document.getElementById('set-new-pass2').value;
  if (a !== b) {
    msg.textContent = 'New passwords do not match';
    msg.className = 'text-sm rounded-lg px-3 py-2 bg-red-50 text-red-700';
    return;
  }
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: document.getElementById('set-cur-pass').value,
        new_password: a
      })
    });
    msg.textContent = 'Password updated successfully';
    msg.className = 'text-sm rounded-lg px-3 py-2 bg-emerald-50 text-emerald-700';
    document.getElementById('set-cur-pass').value = '';
    document.getElementById('set-new-pass').value = '';
    document.getElementById('set-new-pass2').value = '';
  } catch (e) {
    msg.textContent = e.message;
    msg.className = 'text-sm rounded-lg px-3 py-2 bg-red-50 text-red-700';
  }
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
    <div class="px-5 py-3 border-b text-sm text-slate-500">After a client pays by M-Pesa, click <strong class="text-emerald-700">Mark paid</strong> to unlock them for 30 days.</div>
    <table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
        <th class="px-5 py-3">Company</th><th class="py-3">Contact</th><th class="py-3">Vehicles</th><th class="py-3">Status</th><th class="py-3">Next bill</th><th class="py-3 text-right">Actions</th>
      </tr></thead>
      <tbody class="divide-y">
        ${companies.map(c => `
          <tr>
            <td class="px-5 py-3 font-medium">${esc(c.name)}</td>
            <td class="py-3 text-xs">${esc(c.phone||c.email||'—')}</td>
            <td class="py-3">${c.vehicle_count} / ${c.vehicle_limit}</td>
            <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${c.subscription_status==='active'?'bg-emerald-50 text-emerald-700':c.subscription_status==='suspended'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}">${c.subscription_status}</span></td>
            <td class="py-3 text-xs">${c.next_billing_date||c.trial_ends||'—'}</td>
            <td class="py-3 text-right whitespace-nowrap space-x-1">
              <button onclick="adminMarkPaid('${c.id}')" class="text-xs bg-emerald-600 text-white px-2 py-1 rounded-md font-medium">Mark paid</button>
              <button onclick="adminSetStatus('${c.id}','past_due')" class="text-xs text-amber-700">Past due</button>
              <button onclick="adminSuspend('${c.id}')" class="text-xs text-red-600">Suspend</button>
            </td>
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
  const fxDefault = Number(currentCompany?.usd_tzs_rate) || 2600;
  const totalTzs = trips.reduce((s, t) => s + (Number(t.revenue_tzs) || 0), 0);
  const totalUsd = trips.reduce((s, t) => s + (Number(t.revenue_usd) || 0), 0);
  return `
  <div class="page-enter space-y-5">
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Trips</div><div class="text-2xl font-bold mt-1">${trips.length}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Revenue (TZS books)</div><div class="text-xl font-bold mt-1">TZS ${fmt(totalTzs)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Revenue recorded in USD</div><div class="text-xl font-bold mt-1">USD ${fmt(totalUsd)}</div>
        <div class="text-xs text-slate-400 mt-1">Default rate: 1 USD = ${fmt(fxDefault)} TZS</div></div>
    </div>
    <div class="flex justify-between items-center flex-wrap gap-2">
      <p class="text-sm text-slate-500">Local jobs in TZS · Transit often in USD (converted for P&amp;L)</p>
      <button onclick="document.getElementById('trip-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> New trip
      </button>
    </div>
    <div id="trip-form" class="hidden bg-white rounded-2xl border p-5 space-y-3">
      <h3 class="font-semibold">Log trip &amp; payment</h3>
      <div class="grid sm:grid-cols-3 gap-3">
        <select id="t-vehicle" class="border rounded-lg px-3 py-2 text-sm"><option value="">Vehicle *</option>${vehicles.map(v=>`<option value="${v.id}">${v.plate}</option>`).join('')}</select>
        <select id="t-driver" class="border rounded-lg px-3 py-2 text-sm"><option value="">Driver</option>${drivers.map(d=>`<option value="${d.id}">${d.name}</option>`).join('')}</select>
        <select id="t-type" class="border rounded-lg px-3 py-2 text-sm">
          <option value="local">Local (TZ)</option>
          <option value="transit">Transit / cross-border</option>
          <option value="long_haul">Long haul</option>
          <option value="daladala">Dala dala</option>
          <option value="hire">Hire / charter</option>
        </select>
        <input id="t-origin" placeholder="Origin" class="border rounded-lg px-3 py-2 text-sm">
        <input id="t-dest" placeholder="Destination" class="border rounded-lg px-3 py-2 text-sm">
        <select id="t-currency" onchange="onTripCurrencyChange()" class="border rounded-lg px-3 py-2 text-sm">
          <option value="TZS">Paid in TZS (local)</option>
          <option value="USD">Paid in USD (transit)</option>
        </select>
        <input id="t-revenue" type="number" step="0.01" min="0" placeholder="Amount received *" class="border rounded-lg px-3 py-2 text-sm" oninput="calcTripTzs()">
        <div id="t-fx-wrap" class="hidden">
          <input id="t-fx" type="number" step="1" min="1" value="${fxDefault}" placeholder="TZS per 1 USD" class="border rounded-lg px-3 py-2 text-sm w-full" oninput="calcTripTzs()">
        </div>
        <div id="t-tzs-equiv" class="border border-emerald-100 bg-emerald-50 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-900 flex items-center">TZS equiv: 0</div>
      </div>
      <p class="text-xs text-slate-500">USD trips: enter the USD amount and rate (editable). System stores USD + TZS equivalent for reports.</p>
      <button onclick="saveTrip()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Save trip</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Route</th><th class="py-3">Vehicle</th><th class="py-3">Type</th><th class="py-3">Paid</th><th class="py-3 text-right">TZS (books)</th><th class="py-3">Status</th>
        </tr></thead>
        <tbody class="divide-y">
          ${trips.map(t => {
            const cur = t.currency || 'TZS';
            const paid = cur === 'USD'
              ? `USD ${fmt(t.revenue_usd || t.revenue_amount || 0)}${t.fx_rate ? ' <span class="text-xs text-slate-400">@'+fmt(t.fx_rate)+'</span>' : ''}`
              : `TZS ${fmt(t.revenue_amount != null ? t.revenue_amount : t.revenue_tzs || 0)}`;
            return `<tr class="hover:bg-slate-50">
              <td class="px-5 py-3"><div class="font-medium">${esc(t.origin||'—')} → ${esc(t.destination||'—')}</div>
                <div class="text-xs text-slate-400">${dMap[t.driver_id]||''}</div></td>
              <td class="py-3">${vMap[t.vehicle_id]||'—'}</td>
              <td class="py-3 text-xs capitalize">${esc((t.type||'').replace(/_/g,' '))}</td>
              <td class="py-3 text-xs">${paid}</td>
              <td class="py-3 text-right font-semibold">TZS ${fmt(t.revenue_tzs||0)}</td>
              <td class="py-3">${statusBadge(t.status==='in_progress'?'on_route':t.status==='completed'?'idle':t.status)}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="6" class="px-5 py-10 text-center text-slate-400">No trips yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}
function onTripCurrencyChange() {
  const cur = document.getElementById('t-currency')?.value;
  const wrap = document.getElementById('t-fx-wrap');
  if (wrap) wrap.classList.toggle('hidden', cur !== 'USD');
  calcTripTzs();
}
function calcTripTzs() {
  const cur = document.getElementById('t-currency')?.value || 'TZS';
  const amount = parseFloat(document.getElementById('t-revenue')?.value) || 0;
  const fx = parseFloat(document.getElementById('t-fx')?.value) || (Number(currentCompany?.usd_tzs_rate) || 2600);
  const tzs = cur === 'USD' ? Math.round(amount * fx) : amount;
  const el = document.getElementById('t-tzs-equiv');
  if (el) el.textContent = 'TZS equiv: ' + (tzs ? Number(tzs).toLocaleString() : '0');
}
async function saveTrip() {
  try {
    const currency = document.getElementById('t-currency')?.value || 'TZS';
    const revenue_amount = +document.getElementById('t-revenue').value || 0;
    const fx_rate = +document.getElementById('t-fx')?.value || (Number(currentCompany?.usd_tzs_rate) || 2600);
    await api('/api/trips', { method:'POST', body: JSON.stringify({
      vehicle_id: document.getElementById('t-vehicle').value,
      driver_id: document.getElementById('t-driver').value,
      type: document.getElementById('t-type').value,
      origin: document.getElementById('t-origin').value,
      destination: document.getElementById('t-dest').value,
      currency,
      revenue_amount,
      fx_rate: currency === 'USD' ? fx_rate : undefined,
      revenue_tzs: currency === 'TZS' ? revenue_amount : Math.round(revenue_amount * fx_rate)
    })});
    showPage('trips');
  } catch(e) { alert(e.message); }
}

async function renderMaintenance() {
  let items = [], vehicles = [], due = [];
  try {
    const [mRes, vRes, dRes] = await Promise.all([
      api('/api/maintenance'),
      api('/api/vehicles'),
      api('/api/maintenance/due').catch(() => ({ due: [] }))
    ]);
    items = mRes.items || [];
    vehicles = vRes.vehicles || [];
    due = dRes.due || [];
  } catch (err) {
    return `<div class="page-enter p-6 bg-red-50 rounded-xl text-red-700">Could not load maintenance: ${err.message}</div>`;
  }
  const vMap = Object.fromEntries(vehicles.map(v => [v.id, v.plate]));
  const duePanel = `
    <div class="bg-white rounded-xl border overflow-hidden">
      <div class="px-5 py-4 border-b">
        <h3 class="font-semibold">Service by odometer</h3>
        <p class="text-xs text-slate-500">Engine oil, filters, brakes — based on each truck’s km reading</p>
      </div>
      <div class="overflow-x-auto">
      <table class="w-full text-sm"><thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
        <th class="px-4 py-2">Vehicle</th><th class="py-2">Service</th><th class="py-2">Current km</th><th class="py-2">Due at km</th><th class="py-2">Remaining</th><th class="py-2">Status</th>
      </tr></thead><tbody class="divide-y">
        ${due.filter(d => d.status !== 'ok').slice(0,15).map(d => `<tr>
          <td class="px-4 py-2 font-medium">${d.plate}</td>
          <td class="py-2">${d.label}</td>
          <td class="py-2">${fmt(d.current_odometer)}</td>
          <td class="py-2">${fmt(d.next_due_odometer)}</td>
          <td class="py-2">${d.km_remaining} km</td>
          <td class="py-2"><span class="text-xs px-2 py-0.5 rounded ${d.status==='overdue'?'bg-red-50 text-red-700':d.status==='due_soon'?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}">${String(d.status).replace('_',' ')}</span></td>
        </tr>`).join('') || '<tr><td colspan="6" class="px-4 py-4 text-slate-400 text-center">All services within interval</td></tr>'}
      </tbody></table></div>
    </div>`;
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
          <option value="engine_oil">Engine oil</option>
          <option value="oil_filter">Oil filter</option>
          <option value="air_filter">Air filter</option>
          <option value="fuel_filter">Fuel filter</option>
          <option value="tyre_rotation">Tyre rotation</option>
          <option value="brake_inspection">Brake inspection</option>
          <option value="full_service">Full service</option>
          <option value="other">Other</option>
        </select>
        <select id="m-priority" class="border rounded-lg px-3 py-2 text-sm">
          <option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option>
        </select>
        <input id="m-due" type="date" class="border rounded-lg px-3 py-2 text-sm">
        <input id="m-desc" placeholder="Description" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
      </div>
      <button onclick="saveMaint()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
          <th class="px-5 py-3">Vehicle</th><th class="py-3">Type</th><th class="py-3">Description</th><th class="py-3">Due</th><th class="py-3">Priority</th><th class="py-3">Status</th><th class="py-3"></th>
        </tr></thead>
        <tbody class="divide-y">
          ${items.map(m => `<tr>
            <td class="px-5 py-3 font-medium">${vMap[m.vehicle_id]||'—'}</td>
            <td class="py-3 text-xs">${(m.type||'').replace(/_/g,' ')}</td>
            <td class="py-3">${m.description||'—'}</td>
            <td class="py-3">${m.due_date||'—'}</td>
            <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${m.priority==='high'?'bg-red-50 text-red-700':m.priority==='low'?'bg-slate-100':'bg-amber-50 text-amber-700'}">${m.priority||'—'}</span></td>
            <td class="py-3"><span class="text-xs px-2 py-0.5 rounded ${m.status==='completed'?'bg-emerald-50 text-emerald-700':m.status==='overdue'?'bg-red-50 text-red-700':'bg-blue-50 text-blue-700'}">${m.status||'—'}</span></td>
            <td class="py-3 pr-3">${m.status!=='completed'?`<button onclick="completeMaint('${m.id}')" class="text-xs text-brand-600">Complete</button>`:''}</td>
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
  const today = new Date().toISOString().slice(0, 10);
  return `
  <div class="page-enter space-y-5">
    <div class="grid sm:grid-cols-4 gap-4">
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">MTD liters</div><div class="text-2xl font-bold mt-1">${fmt(summary.mtd_liters)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">MTD cost</div><div class="text-2xl font-bold mt-1">TZS ${fmt(summary.mtd_cost_tzs)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">All-time liters</div><div class="text-2xl font-bold mt-1">${fmt(summary.total_liters)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">All-time cost</div><div class="text-2xl font-bold mt-1">TZS ${fmt(summary.total_cost_tzs)}</div></div>
    </div>
    <div class="flex justify-between items-center">
      <p class="text-sm text-slate-500">${logs.length} fuel log(s)</p>
      <button onclick="document.getElementById('fuel-form').classList.toggle('hidden')" class="bg-brand-600 text-white text-sm px-4 py-2.5 rounded-xl font-medium flex items-center gap-2">
        <i data-lucide="plus" class="w-4 h-4"></i> Log fuel
      </button>
    </div>

    <div id="fuel-form" class="hidden bg-white rounded-2xl border border-brand-100 shadow-sm p-6 space-y-4">
      <div>
        <h3 class="font-semibold text-slate-900">Record fuel fill</h3>
        <p class="text-sm text-slate-500 mt-0.5">Select truck → enter litres → enter price per litre → total is calculated automatically</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div class="sm:col-span-2 lg:col-span-1">
          <label class="text-xs font-medium text-slate-600">Vehicle / truck *</label>
          <select id="f-vehicle" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
            <option value="">Select plate number</option>
            ${vehicles.map(v => `<option value="${v.id}">${v.plate} · ${v.make||''} ${v.model||''} (${v.type||''})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs font-medium text-slate-600">Litres filled *</label>
          <input id="f-liters" type="number" step="0.01" min="0.01" placeholder="e.g. 180"
            oninput="calcFuelTotal()" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </div>
        <div>
          <label class="text-xs font-medium text-slate-600">Price per litre (TZS) *</label>
          <input id="f-price" type="number" step="1" min="1" placeholder="e.g. 3200"
            oninput="calcFuelTotal()" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </div>
        <div>
          <label class="text-xs font-medium text-slate-600">Total cost (auto)</label>
          <div id="f-total-display" class="mt-1 w-full border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2.5 text-sm font-bold text-emerald-800">
            TZS 0
          </div>
          <input type="hidden" id="f-cost" value="0">
        </div>
        <div>
          <label class="text-xs font-medium text-slate-600">Station / location</label>
          <input id="f-station" placeholder="e.g. PUMA Ubungo" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </div>
        <div>
          <label class="text-xs font-medium text-slate-600">Odometer (km)</label>
          <input id="f-odo" type="number" placeholder="Optional" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </div>
        <div>
          <label class="text-xs font-medium text-slate-600">Date filled</label>
          <input id="f-date" type="date" value="${today}" class="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        </div>
      </div>
      <button onclick="saveFuel()" class="bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">Save fuel log</button>
    </div>

    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
            <th class="px-5 py-3">Date</th>
            <th class="py-3">Vehicle</th>
            <th class="py-3 text-right">Litres</th>
            <th class="py-3 text-right">Price / L</th>
            <th class="py-3 text-right">Total cost</th>
            <th class="py-3">Station</th>
            <th class="py-3 text-right">Odo</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          ${logs.map(l => {
            const price = l.price_per_liter != null ? l.price_per_liter : (l.liters ? Math.round((l.cost_tzs||0)/l.liters) : 0);
            return `<tr class="hover:bg-slate-50">
              <td class="px-5 py-3 text-xs text-slate-500">${(l.filled_at||'').slice(0,10)}</td>
              <td class="py-3 font-medium">${vMap[l.vehicle_id]||'—'}</td>
              <td class="py-3 text-right font-medium">${l.liters||0}</td>
              <td class="py-3 text-right text-slate-600">TZS ${fmt(price)}</td>
              <td class="py-3 text-right font-bold text-slate-900">TZS ${fmt(l.cost_tzs||0)}</td>
              <td class="py-3 text-xs text-slate-500">${l.station||'—'}</td>
              <td class="py-3 text-right text-xs text-slate-500">${l.odometer ? fmt(l.odometer)+' km' : '—'}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="7" class="px-5 py-10 text-center text-slate-400">No fuel logs yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}
function calcFuelTotal() {
  const liters = parseFloat(document.getElementById('f-liters')?.value) || 0;
  const price = parseFloat(document.getElementById('f-price')?.value) || 0;
  const total = Math.round(liters * price);
  const el = document.getElementById('f-total-display');
  const hid = document.getElementById('f-cost');
  if (el) el.textContent = 'TZS ' + (total ? total.toLocaleString() : '0');
  if (hid) hid.value = total;
}
async function saveFuel() {
  try {
    const vehicle_id = document.getElementById('f-vehicle').value;
    const liters = parseFloat(document.getElementById('f-liters').value) || 0;
    const price_per_liter = parseFloat(document.getElementById('f-price').value) || 0;
    if (!vehicle_id) throw new Error('Select a vehicle from the list');
    if (liters <= 0) throw new Error('Enter litres filled');
    if (price_per_liter <= 0) throw new Error('Enter fuel price per litre');
    const cost_tzs = Math.round(liters * price_per_liter);
    await api('/api/fuel', { method:'POST', body: JSON.stringify({
      vehicle_id,
      liters,
      price_per_liter,
      cost_tzs,
      odometer: +document.getElementById('f-odo').value || 0,
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
  let co = currentCompany || {};
  try { const pr = await api('/api/company/profile'); co = pr.company || co; } catch(e) {}
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
    <div class="bg-white rounded-xl border p-5">
      <div class="flex justify-between items-center mb-3">
        <div>
          <h3 class="font-semibold">Company invoice details</h3>
          <p class="text-xs text-slate-500">Shown on printed invoices (name, TIN, address)</p>
        </div>
      </div>
      <div class="grid sm:grid-cols-3 gap-3">
        <input id="co-name" value="${(co.name||'').replace(/"/g,'&quot;')}" placeholder="Company name" class="border rounded-lg px-3 py-2 text-sm">
        <input id="co-tin" value="${co.tin||''}" placeholder="TIN number" class="border rounded-lg px-3 py-2 text-sm">
        <input id="co-vrn" value="${co.vrn||''}" placeholder="VRN (VAT reg.)" class="border rounded-lg px-3 py-2 text-sm">
        <input id="co-phone" value="${co.phone||''}" placeholder="Phone" class="border rounded-lg px-3 py-2 text-sm">
        <input id="co-address" value="${(co.address||'').replace(/"/g,'&quot;')}" placeholder="Address" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
      </div>
      <button onclick="saveCompanyProfile()" class="mt-3 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg">Save company details</button>
    </div>

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
            <input id="inv-client-tin" placeholder="Client TIN (optional)" class="border rounded-lg px-3 py-2 text-sm">
            <input id="inv-total" type="number" placeholder="Subtotal TZS (before VAT)" class="border rounded-lg px-3 py-2 text-sm">
            <input id="inv-advance" type="number" placeholder="Advance paid TZS" class="border rounded-lg px-3 py-2 text-sm">
            <select id="inv-terms" class="border rounded-lg px-3 py-2 text-sm">
              <option value="advance">Full advance</option>
              <option value="on_delivery">Pay on delivery</option>
              <option value="credit_days">Credit (days after)</option>
            </select>
            <input id="inv-credit" type="number" placeholder="Credit days" value="14" class="border rounded-lg px-3 py-2 text-sm">
            <input id="inv-route" placeholder="Origin → Destination" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2">
            <label class="flex items-center gap-2 text-sm sm:col-span-2 cursor-pointer">
              <input type="checkbox" id="inv-vat" class="rounded border-slate-300">
              <span>Add VAT 18% (Tanzania)</span>
            </label>
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
      client_tin: document.getElementById('inv-client-tin')?.value || '',
      subtotal_tzs: +document.getElementById('inv-total').value,
      total_tzs: +document.getElementById('inv-total').value,
      advance_tzs: +document.getElementById('inv-advance').value || 0,
      payment_terms: document.getElementById('inv-terms').value,
      credit_days: +document.getElementById('inv-credit').value || 0,
      vat_enabled: !!(document.getElementById('inv-vat')?.checked),
      vat_rate: 18,
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
  const [invRes, vehRes] = await Promise.all([
    api('/api/inventory'),
    api('/api/vehicles').catch(() => ({ vehicles: [] }))
  ]);
  const parts = invRes.parts || [];
  const moves = invRes.moves || [];
  const summary = invRes.summary || {};
  const vehicles = vehRes.vehicles || [];
  const lowParts = parts.filter(x => Number(x.stock) <= Number(x.min_stock));
  const maxStock = Math.max(1, ...parts.map(p => Number(p.stock) || 0));
  const byCat = {};
  parts.forEach(p => {
    const c = p.category || 'general';
    byCat[c] = (byCat[c] || 0) + (Number(p.stock) || 0);
  });
  const catEntries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  const maxCat = Math.max(1, ...catEntries.map(x => x[1]));
  const recentIssues = moves.filter(m => m.type === 'issue').slice(0, 8);
  const recentRecv = moves.filter(m => m.type === 'receive').slice(0, 8);
  const partOpts = parts.map(x => `<option value="${x.id}">${esc(x.sku)} — ${esc(x.name)} (qty ${Number(x.stock)||0})</option>`).join('');
  const vehOpts = vehicles.map(v => `<option value="${v.id}" data-plate="${esc(v.plate)}">${esc(v.plate)}</option>`).join('');

  return `
  <div class="page-enter space-y-6">
    <!-- KPI row -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 shadow-lg">
        <div class="text-xs uppercase tracking-wide text-slate-400 font-medium">Store SKUs</div>
        <div class="text-3xl font-bold mt-1">${parts.length}</div>
        <div class="text-xs text-slate-400 mt-2">Registered parts</div>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div class="text-xs uppercase tracking-wide text-slate-500 font-medium">Stock value</div>
        <div class="text-2xl font-bold mt-1 text-slate-900">TZS ${fmt(summary.stock_value_tzs||0)}</div>
        <div class="text-xs text-slate-400 mt-2">At unit cost</div>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div class="text-xs uppercase tracking-wide text-slate-500 font-medium">Reorder alerts</div>
        <div class="text-3xl font-bold mt-1 ${lowParts.length?'text-red-600':'text-emerald-600'}">${lowParts.length}</div>
        <div class="text-xs text-slate-400 mt-2">Below minimum</div>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div class="text-xs uppercase tracking-wide text-slate-500 font-medium">Issued today</div>
        <div class="text-3xl font-bold mt-1 text-brand-700">${summary.issues_today||0}</div>
        <div class="text-xs text-slate-400 mt-2">${summary.qty_issued_today||0} units out</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex flex-wrap gap-2 items-center">
      <button onclick="whShowPanel('issue')" class="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm">
        <i data-lucide="arrow-up-right" class="w-4 h-4"></i> Issue to vehicle
      </button>
      <button onclick="whShowPanel('receive')" class="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm">
        <i data-lucide="package-plus" class="w-4 h-4"></i> Receive goods
      </button>
      <button onclick="whShowPanel('add')" class="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-xl">
        <i data-lucide="plus" class="w-4 h-4"></i> New part
      </button>
      <button onclick="printWarehouseReport()" class="inline-flex items-center gap-2 ml-auto bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl">
        <i data-lucide="printer" class="w-4 h-4"></i> Print stock report
      </button>
    </div>

    <!-- Panels -->
    <div id="wh-issue" class="hidden bg-white rounded-2xl border border-brand-100 shadow-sm p-6">
      <h3 class="font-semibold text-lg text-slate-900 mb-1">Issue parts from store</h3>
      <p class="text-sm text-slate-500 mb-4">Reduce stock when parts leave the warehouse for a truck or job</p>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <select id="iss-part" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm"><option value="">Select part *</option>${partOpts}</select>
        <input id="iss-qty" type="number" min="1" placeholder="Quantity *" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <select id="iss-vehicle" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm"><option value="">Vehicle</option>${vehOpts}</select>
        <input id="iss-to" placeholder="Issued to (mechanic)" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="iss-reason" placeholder="Job / reason" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="iss-ref" placeholder="WO / reference" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
      </div>
      <button onclick="doIssuePart()" class="mt-4 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">Confirm issue</button>
    </div>

    <div id="wh-receive" class="hidden bg-white rounded-2xl border border-emerald-100 shadow-sm p-6">
      <h3 class="font-semibold text-lg text-slate-900 mb-1">Receive goods into store</h3>
      <p class="text-sm text-slate-500 mb-4">Increase stock when delivery arrives from supplier</p>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <select id="rcv-part" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm sm:col-span-2"><option value="">Select part *</option>${partOpts}</select>
        <input id="rcv-qty" type="number" min="1" placeholder="Qty received *" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="rcv-ref" placeholder="GRN / invoice no." class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="rcv-reason" placeholder="Supplier / note" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm sm:col-span-2">
      </div>
      <button onclick="doReceivePart()" class="mt-4 bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">Confirm receive</button>
    </div>

    <div id="wh-add" class="hidden bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h3 class="font-semibold text-lg text-slate-900 mb-1">Register new part</h3>
      <p class="text-sm text-slate-500 mb-4">Creates the item at <strong>0 qty</strong>. Use <em>Receive goods</em> to add stock.</p>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <input id="ip-sku" placeholder="SKU (optional)" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="ip-name" placeholder="Part name *" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm sm:col-span-2">
        <select id="ip-cat" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
          <option value="oil">Engine oil</option><option value="filter">Filter</option>
          <option value="tyre">Tyre</option><option value="brake">Brake</option>
          <option value="battery">Battery</option><option value="general">General</option>
        </select>
        <input id="ip-min" type="number" min="0" placeholder="Reorder level (min)" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="ip-unit" placeholder="Unit" value="pcs" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="ip-cost" type="number" min="0" placeholder="Unit cost TZS" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="ip-location" placeholder="Shelf / bin location" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
        <input id="ip-supplier" placeholder="Preferred supplier" class="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
      </div>
      <button onclick="saveInventoryPart()" class="mt-4 bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">Save part (qty = 0)</button>
    </div>

    <!-- Charts + low stock -->
    <div class="grid lg:grid-cols-3 gap-5">
      <div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-slate-900">Stock by part</h3>
          <span class="text-xs text-slate-400">Qty on hand</span>
        </div>
        <div class="space-y-3 max-h-72 overflow-y-auto pr-1">
          ${parts.slice().sort((a,b)=>(Number(b.stock)||0)-(Number(a.stock)||0)).slice(0,12).map(p => {
            const qty = Number(p.stock)||0;
            const pct = Math.round((qty / maxStock) * 100);
            const danger = qty <= Number(p.min_stock);
            return `<div>
              <div class="flex justify-between text-sm mb-1">
                <span class="font-medium text-slate-700 truncate max-w-[60%]">${esc(p.name)}</span>
                <span class="font-semibold ${danger?'text-red-600':'text-slate-800'}">${qty} <span class="text-xs font-normal text-slate-400">${esc(p.unit||'pcs')}</span></span>
              </div>
              <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full ${danger?'bg-red-500':'bg-brand-500'}" style="width:${Math.max(pct,2)}%"></div>
              </div>
            </div>`;
          }).join('') || '<p class="text-sm text-slate-400 py-8 text-center">No parts yet — add a part then receive stock</p>'}
        </div>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h3 class="font-semibold text-slate-900 mb-4">By category</h3>
        <div class="space-y-3">
          ${catEntries.map(([c,q]) => {
            const pct = Math.round((q/maxCat)*100);
            return `<div>
              <div class="flex justify-between text-xs mb-1"><span class="uppercase tracking-wide text-slate-500">${esc(c)}</span><span class="font-semibold">${q}</span></div>
              <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-violet-500 rounded-full" style="width:${Math.max(pct,3)}%"></div></div>
            </div>`;
          }).join('') || '<p class="text-sm text-slate-400">No data</p>'}
        </div>
        ${lowParts.length ? `<div class="mt-5 pt-4 border-t">
          <div class="text-xs font-semibold text-red-600 uppercase mb-2">Reorder now</div>
          <ul class="text-sm space-y-1">${lowParts.slice(0,5).map(p=>`<li class="flex justify-between"><span>${esc(p.name)}</span><span class="text-red-600 font-medium">${Number(p.stock)||0}/${Number(p.min_stock)||0}</span></li>`).join('')}</ul>
        </div>` : ''}
      </div>
    </div>

    <!-- Stock table -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 class="font-semibold text-slate-900">Store stock list</h3>
        <span class="text-xs text-slate-400">${parts.length} items</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b">
              <th class="px-5 py-3">SKU</th>
              <th class="py-3">Part</th>
              <th class="py-3">Location</th>
              <th class="py-3 text-right">Qty on hand</th>
              <th class="py-3 text-right">Reorder at</th>
              <th class="py-3">Status</th>
              <th class="py-3 pr-5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${parts.map(x => {
              const qty = Number(x.stock) || 0;
              const min = Number(x.min_stock) || 0;
              const low = qty <= min;
              return `<tr class="hover:bg-slate-50/80">
                <td class="px-5 py-3 font-mono text-xs text-slate-500">${esc(x.sku)}</td>
                <td class="py-3">
                  <div class="font-medium text-slate-900">${esc(x.name)}</div>
                  <div class="text-xs text-slate-400 capitalize">${esc(x.category||'')}</div>
                </td>
                <td class="py-3 text-xs text-slate-500">${esc(x.location||'—')}</td>
                <td class="py-3 text-right">
                  <span class="text-base font-bold text-slate-900">${qty}</span>
                  <span class="text-xs text-slate-400 ml-1">${esc(x.unit||'pcs')}</span>
                </td>
                <td class="py-3 text-right text-slate-500">${min}</td>
                <td class="py-3">${low
                  ? '<span class="inline-flex text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700">Reorder</span>'
                  : '<span class="inline-flex text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">OK</span>'}</td>
                <td class="py-3 pr-5 text-right space-x-2 whitespace-nowrap">
                  <button onclick="quickReceive('${x.id}')" class="text-xs font-medium text-emerald-600 hover:underline">+ Receive</button>
                  <button onclick="quickIssue('${x.id}')" class="text-xs font-medium text-brand-600 hover:underline">Issue</button>
                </td>
              </tr>`;
            }).join('') || '<tr><td colspan="7" class="px-5 py-12 text-center text-slate-400">No parts in store. Click <strong>New part</strong> then <strong>Receive goods</strong>.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Movements -->
    <div class="grid lg:grid-cols-2 gap-5">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b bg-emerald-50/50 font-semibold text-sm text-emerald-900">Recent receives</div>
        <ul class="divide-y text-sm max-h-56 overflow-y-auto">
          ${recentRecv.map(m => {
            const part = parts.find(p => p.id === m.part_id);
            return `<li class="px-5 py-2.5 flex justify-between gap-2">
              <span><span class="font-medium">+${m.qty||0}</span> ${esc(part?.name||'Part')}</span>
              <span class="text-xs text-slate-400">${(m.created_at||'').slice(0,16).replace('T',' ')}</span>
            </li>`;
          }).join('') || '<li class="px-5 py-6 text-center text-slate-400">No receives yet</li>'}
        </ul>
      </div>
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b bg-amber-50/50 font-semibold text-sm text-amber-900">Recent issues</div>
        <ul class="divide-y text-sm max-h-56 overflow-y-auto">
          ${recentIssues.map(m => {
            const part = parts.find(p => p.id === m.part_id);
            return `<li class="px-5 py-2.5 flex justify-between gap-2">
              <span><span class="font-medium text-amber-800">−${m.qty||0}</span> ${esc(part?.name||'Part')} ${m.vehicle_plate?'→ '+esc(m.vehicle_plate):''}</span>
              <span class="text-xs text-slate-400">${(m.created_at||'').slice(0,16).replace('T',' ')}</span>
            </li>`;
          }).join('') || '<li class="px-5 py-6 text-center text-slate-400">No issues yet</li>'}
        </ul>
      </div>
    </div>
  </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function whShowPanel(which) {
  ['issue','receive','add'].forEach(p => {
    const el = document.getElementById('wh-' + p);
    if (el) el.classList.toggle('hidden', p !== which);
  });
}
function quickIssue(partId) {
  whShowPanel('issue');
  const sel = document.getElementById('iss-part');
  if (sel) sel.value = partId;
  document.getElementById('iss-qty')?.focus();
}
function quickReceive(partId) {
  whShowPanel('receive');
  const sel = document.getElementById('rcv-part');
  if (sel) sel.value = partId;
  document.getElementById('rcv-qty')?.focus();
}
async function doIssuePart() {
  try {
    const sel = document.getElementById('iss-vehicle');
    const plate = sel?.selectedOptions?.[0]?.dataset?.plate || '';
    await api('/api/inventory/issue', { method:'POST', body: JSON.stringify({
      part_id: document.getElementById('iss-part').value,
      qty: +document.getElementById('iss-qty').value,
      vehicle_id: document.getElementById('iss-vehicle').value || null,
      vehicle_plate: plate,
      issued_to: document.getElementById('iss-to').value,
      reason: document.getElementById('iss-reason').value,
      reference: document.getElementById('iss-ref').value
    })});
    showPage('inventory');
  } catch(e) { alert(e.message); }
}
async function doReceivePart() {
  try {
    const qty = +document.getElementById('rcv-qty').value;
    if (!qty || qty < 1) throw new Error('Enter quantity received');
    await api('/api/inventory/receive', { method:'POST', body: JSON.stringify({
      part_id: document.getElementById('rcv-part').value,
      qty,
      reason: document.getElementById('rcv-reason').value || 'Goods received',
      reference: document.getElementById('rcv-ref').value
    })});
    showPage('inventory');
  } catch(e) { alert(e.message); }
}
async function saveInventoryPart() {
  try {
    const name = (document.getElementById('ip-name')?.value || '').trim();
    if (!name) throw new Error('Part name is required');
    await api('/api/inventory', { method:'POST', body: JSON.stringify({
      sku: document.getElementById('ip-sku').value,
      name,
      category: document.getElementById('ip-cat').value,
      min_stock: +document.getElementById('ip-min').value || 0,
      unit: document.getElementById('ip-unit').value || 'pcs',
      unit_cost_tzs: +document.getElementById('ip-cost').value || 0,
      location: document.getElementById('ip-location')?.value || '',
      supplier_name: document.getElementById('ip-supplier').value
    })});
    showPage('inventory');
  } catch(e) { alert(e.message); }
}
async function printWarehouseReport() {
  try {
    const { parts, summary, moves } = await api('/api/inventory');
    const co = currentCompany || {};
    const w = window.open('', '_blank', 'width=900,height=1000');
    const rows = (parts||[]).map(p => `<tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:12px">${p.sku||''}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${p.name||''}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${Number(p.stock)||0}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${p.unit||'pcs'}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${Number(p.min_stock)||0}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${p.location||'—'}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${((Number(p.stock)||0)*(Number(p.unit_cost_tzs)||0)).toLocaleString()}</td>
    </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html><head><title>Stock Report</title>
      <style>body{font-family:Inter,system-ui,sans-serif;padding:32px;color:#0f172a}
      h1{color:#0c8ce9;margin:0} .muted{color:#64748b;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}
      th{text-align:left;padding:8px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b}
      .kpi{display:flex;gap:24px;margin:16px 0} .kpi div{padding:12px 16px;background:#f8fafc;border-radius:12px}
      @media print{button{display:none}}</style></head><body>
      <h1>${co.name || 'MlimaniFleet'} — Warehouse stock report</h1>
      <p class="muted">Printed ${new Date().toLocaleString()} · ${co.address || ''}</p>
      <div class="kpi">
        <div><div class="muted">SKUs</div><strong>${(parts||[]).length}</strong></div>
        <div><div class="muted">Stock value</div><strong>TZS ${(summary.stock_value_tzs||0).toLocaleString()}</strong></div>
        <div><div class="muted">Low stock</div><strong>${summary.low_stock||0}</strong></div>
      </div>
      <table><thead><tr><th>SKU</th><th>Part</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Min</th><th>Location</th><th style="text-align:right">Value TZS</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">No parts</td></tr>'}</tbody></table>
      <p class="muted" style="margin-top:24px">Recent movements: ${(moves||[]).length} recorded</p>
      <button onclick="window.print()" style="margin-top:20px;padding:10px 20px;background:#0c8ce9;color:#fff;border:0;border-radius:8px;cursor:pointer">Print / PDF</button>
      </body></html>`);
    w.document.close();
  } catch(e) { alert(e.message); }
}

async function renderReports() {
  const vehicles = (await api('/api/vehicles').catch(() => ({ vehicles: [] }))).vehicles || [];
  const drivers = (await api('/api/drivers').catch(() => ({ drivers: [] }))).drivers || [];
  const from = document.getElementById('rpt-from')?.value || '';
  const to = document.getElementById('rpt-to')?.value || '';
  const vehicleId = document.getElementById('rpt-vehicle')?.value || '';
  const driverId = document.getElementById('rpt-driver')?.value || '';
  const qs = new URLSearchParams({ from, to, vehicle_id: vehicleId, driver_id: driverId });
  const r = await api('/api/reports/summary?' + qs.toString());
  const pnl = r.pnl || {};
  const fleet = r.fleet || {};
  return `
  <div class="page-enter space-y-6">
    <div class="bg-white rounded-xl border p-4 flex flex-wrap gap-3 items-end">
      <div><label class="text-xs text-slate-500">From</label><input id="rpt-from" type="date" value="${from}" class="block border rounded-lg px-3 py-2 text-sm mt-1"></div>
      <div><label class="text-xs text-slate-500">To</label><input id="rpt-to" type="date" value="${to}" class="block border rounded-lg px-3 py-2 text-sm mt-1"></div>
      <div><label class="text-xs text-slate-500">Truck / vehicle</label>
        <select id="rpt-vehicle" class="block border rounded-lg px-3 py-2 text-sm mt-1 min-w-[140px]">
          <option value="">All vehicles</option>
          ${vehicles.map(v => `<option value="${v.id}" ${vehicleId===v.id?'selected':''}>${v.plate}</option>`).join('')}
        </select>
      </div>
      <div><label class="text-xs text-slate-500">Driver</label>
        <select id="rpt-driver" class="block border rounded-lg px-3 py-2 text-sm mt-1 min-w-[140px]">
          <option value="">All drivers</option>
          ${drivers.map(d => `<option value="${d.id}" ${driverId===d.id?'selected':''}>${d.name}</option>`).join('')}
        </select>
      </div>
      <button onclick="showPage('reports')" class="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg">Apply filter</button>
      <button onclick="printReport()" class="border text-sm px-4 py-2 rounded-lg">Print summary</button>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" id="report-summary-cards">
      <div class="bg-white rounded-xl border p-5"><div class="text-xs text-slate-500">Revenue (filtered)</div><div class="text-2xl font-bold mt-1 text-emerald-600">TZS ${fmt(pnl.filtered_trip_revenue_tzs||pnl.filtered_invoice_collected_tzs||pnl.revenue_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-5"><div class="text-xs text-slate-500">Expenses (filtered)</div><div class="text-2xl font-bold mt-1">TZS ${fmt((pnl.filtered_fuel_cost_tzs||0)+(pnl.filtered_maintenance_cost_tzs||0))}</div>
        <div class="text-xs text-slate-400 mt-1">Fuel ${fmt(pnl.filtered_fuel_cost_tzs||0)} · Maint ${fmt(pnl.filtered_maintenance_cost_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-5"><div class="text-xs text-slate-500">Net (filtered)</div><div class="text-2xl font-bold mt-1 ${(pnl.filtered_net_tzs||0)>=0?'text-emerald-600':'text-red-600'}">TZS ${fmt(pnl.filtered_net_tzs||pnl.net_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-5"><div class="text-xs text-slate-500">Fleet utilisation</div><div class="text-2xl font-bold mt-1">${fleet.utilization_pct||0}%</div>
        <div class="text-xs text-slate-400 mt-1">${fleet.on_route||0}/${fleet.total||0} on route</div></div>
    </div>
    <div class="grid sm:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Trips in period</div><div class="text-xl font-bold mt-1">${r.trips_count||0}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Debt to suppliers</div><div class="text-xl font-bold mt-1 text-red-600">TZS ${fmt((r.payables||{}).total_tzs||0)}</div></div>
      <div class="bg-white rounded-xl border p-4"><div class="text-xs text-slate-500">Debt from clients</div><div class="text-xl font-bold mt-1 text-brand-700">TZS ${fmt((r.receivables||{}).total_tzs||0)}</div></div>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <div class="px-5 py-3 border-b font-semibold text-sm">Trips in filter</div>
      <table class="w-full text-sm"><thead><tr class="text-left text-xs text-slate-500 border-b bg-slate-50">
        <th class="px-4 py-2">Route</th><th class="py-2">Revenue</th><th class="py-2">Status</th>
      </tr></thead><tbody class="divide-y">
        ${(r.trips||[]).slice(0,15).map(t => `<tr><td class="px-4 py-2">${t.route||t.origin||'—'} → ${t.destination||''}</td>
          <td class="py-2">TZS ${fmt(t.revenue_tzs||0)}</td><td class="py-2">${t.status||'—'}</td></tr>`).join('') || '<tr><td colspan="3" class="px-4 py-6 text-center text-slate-400">No trips in range</td></tr>'}
      </tbody></table>
    </div>
  </div>`;
}
function printReport() {
  const cards = document.getElementById('report-summary-cards');
  const from = document.getElementById('rpt-from')?.value || '—';
  const to = document.getElementById('rpt-to')?.value || '—';
  const w = window.open('', '_blank', 'width=900,height=1000');
  w.document.write(`<!DOCTYPE html><html><head><title>Fleet Report</title>
    <style>body{font-family:system-ui;padding:32px}h1{color:#0c8ce9}.muted{color:#64748b}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}
    .card{border:1px solid #e2e8f0;border-radius:12px;padding:16px}.card div:first-child{font-size:12px;color:#64748b}
    .card div:last-child{font-size:22px;font-weight:700;margin-top:4px}
    @media print{button{display:none}}</style></head><body>
    <h1>MlimaniFleet — Report summary</h1>
    <p class="muted">Period: ${from} to ${to} · Printed ${new Date().toLocaleString()}</p>
    <div class="grid">${cards ? cards.innerHTML : ''}</div>
    <button onclick="window.print()" style="padding:10px 20px;background:#0c8ce9;color:#fff;border:0;border-radius:8px">Print</button>
    </body></html>`);
  w.document.close();
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
async function printInvoice(invId) {
  const [{ invoices }, profile] = await Promise.all([
    api('/api/invoices'),
    api('/api/company/profile').catch(() => ({ company: currentCompany || {} }))
  ]);
  const i = invoices.find(x => x.id === invId);
  if (!i) return alert('Invoice not found');
  const c = profile.company || currentCompany || {};
  const sub = i.subtotal_tzs != null ? i.subtotal_tzs : (i.total_tzs - (i.vat_tzs || 0));
  const vat = i.vat_tzs || 0;
  const w = window.open('', '_blank', 'width=820,height=960');
  w.document.write(`<!DOCTYPE html><html><head><title>${i.invoice_no}</title>
    <style>
      body{font-family:Inter,system-ui,sans-serif;padding:40px;color:#0f172a;max-width:720px;margin:0 auto}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0c8ce9;padding-bottom:16px;margin-bottom:24px}
      .co-name{font-size:22px;font-weight:700;color:#0c8ce9}
      .muted{color:#64748b;font-size:13px;line-height:1.5}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px}
      th{background:#f8fafc;font-size:12px;color:#64748b;text-transform:uppercase}
      .total{font-size:18px;font-weight:700}
      .badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;background:#f1f5f9}
      @media print{button{display:none}body{padding:20px}}
    </style></head><body>
    <div class="head">
      <div>
        <div class="co-name">${c.name || 'Fleet Company'}</div>
        <div class="muted">
          ${c.address || ''}${c.city ? ', '+c.city : ''}<br>
          ${c.phone ? 'Tel: '+c.phone+'<br>' : ''}
          ${c.email ? c.email+'<br>' : ''}
          ${c.tin ? '<strong>TIN:</strong> '+c.tin+'<br>' : ''}
          ${c.vrn ? '<strong>VRN:</strong> '+c.vrn : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:20px;font-weight:700">INVOICE</div>
        <div class="muted">${i.invoice_no}<br>${i.invoice_date || ''}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:24px;margin-bottom:16px">
      <div>
        <div class="muted" style="margin-bottom:4px">BILL TO</div>
        <div style="font-weight:600">${i.client_name || '—'}</div>
        <div class="muted">${i.client_phone || ''}${i.client_tin ? '<br>TIN: '+i.client_tin : ''}</div>
      </div>
      <div class="muted" style="text-align:right">
        <div><strong>Route:</strong> ${i.origin || '—'} → ${i.destination || '—'}</div>
        <div><strong>Terms:</strong> ${i.payment_terms || ''}${i.credit_days ? ' ('+i.credit_days+' days)' : ''}</div>
        <div><strong>Due date:</strong> ${i.due_date || '—'}</div>
        <div><span class="badge">${i.status || ''}</span></div>
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th style="text-align:right">Amount (TZS)</th></tr></thead>
      <tbody>
        <tr><td>${i.description || 'Cargo transport services'}</td><td style="text-align:right">${Number(sub).toLocaleString()}</td></tr>
        ${i.vat_enabled || vat ? `<tr><td>VAT (${i.vat_rate || 18}%)</td><td style="text-align:right">${Number(vat).toLocaleString()}</td></tr>` : ''}
        <tr><td><strong>Total</strong></td><td style="text-align:right" class="total">${Number(i.total_tzs||0).toLocaleString()}</td></tr>
        <tr><td>Advance paid</td><td style="text-align:right">${Number(i.advance_tzs||0).toLocaleString()}</td></tr>
        <tr><td><strong>Balance due</strong></td><td style="text-align:right" class="total">${Number(i.balance_tzs||0).toLocaleString()}</td></tr>
      </tbody>
    </table>
    <p class="muted" style="margin-top:32px">${c.invoice_footer || 'Thank you for your business.'}</p>
    <button onclick="window.print()" style="margin-top:24px;padding:10px 20px;background:#0c8ce9;color:#fff;border:0;border-radius:8px;cursor:pointer">Print / Save PDF</button>
    </body></html>`);
  w.document.close();
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


// Boot — never leave a blank page
(async function start() {
  try {
    if (token) {
      await bootApp();
    } else {
      document.getElementById('auth-screen')?.classList.remove('hidden');
      document.getElementById('app-shell')?.classList.add('hidden');
      if (window.lucide) lucide.createIcons();
    }
  } catch (e) {
    console.error('start failed', e);
    document.getElementById('app-shell')?.classList.add('hidden');
    document.getElementById('auth-screen')?.classList.remove('hidden');
    alert('App failed to start. Clear site data and try again. ' + (e.message || ''));
  }
})();
