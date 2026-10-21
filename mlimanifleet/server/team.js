/**
 * Company team: sub-users with permissions
 * Roles: fleet_manager (owner), dispatcher, accountant, workshop, viewer, custom
 */
const { read, write, uid, now } = require('./db');
const { hashPassword } = require('./auth');

const ROLE_PRESETS = {
  fleet_manager: {
    label: 'Fleet Manager',
    permissions: {
      vehicles: true, drivers: true, trips: true, maintenance: true, fuel: true,
      finance: true, gps: true, inventory: true, reports: true, billing: true, team: true
    }
  },
  dispatcher: {
    label: 'Dispatcher',
    permissions: {
      vehicles: true, drivers: true, trips: true, maintenance: false, fuel: false,
      finance: false, gps: true, inventory: false, reports: true, billing: false, team: false
    }
  },
  accountant: {
    label: 'Accountant',
    permissions: {
      vehicles: false, drivers: false, trips: true, maintenance: false, fuel: true,
      finance: true, gps: false, inventory: false, reports: true, billing: true, team: false
    }
  },
  workshop: {
    label: 'Workshop',
    permissions: {
      vehicles: true, drivers: false, trips: false, maintenance: true, fuel: false,
      finance: false, gps: false, inventory: true, reports: false, billing: false, team: false
    }
  },
  viewer: {
    label: 'Viewer',
    permissions: {
      vehicles: true, drivers: true, trips: true, maintenance: true, fuel: true,
      finance: true, gps: true, inventory: true, reports: true, billing: false, team: false
    }
  }
};

function listCompanyUsers(auth) {
  if (!auth.company_id && auth.role !== 'platform_admin') return [];
  const users = read('users') || [];
  return users
    .filter(u => u.company_id === auth.company_id)
    .map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      permissions: u.permissions || ROLE_PRESETS[u.role]?.permissions || ROLE_PRESETS.viewer.permissions,
      phone: u.phone || '',
      active: u.active !== false,
      created_at: u.created_at
    }));
}

function canManageTeam(auth) {
  if (auth.role === 'platform_admin') return true;
  if (auth.role === 'fleet_manager') return true;
  const users = read('users') || [];
  const me = users.find(u => u.id === auth.id);
  return !!(me && me.permissions && me.permissions.team);
}

function createCompanyUser(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  if (!canManageTeam(auth)) throw new Error('No permission to manage team');

  const email = (body.email || '').toLowerCase().trim();
  const password = body.password || 'ChangeMe1';
  if (!email) throw new Error('Email required');

  const users = read('users') || [];
  if (users.find(u => u.email === email)) throw new Error('Email already registered');

  const role = body.role || 'viewer';
  if (role === 'platform_admin') throw new Error('Invalid role');

  const permissions = body.permissions || ROLE_PRESETS[role]?.permissions || ROLE_PRESETS.viewer.permissions;

  const user = {
    id: uid(),
    email,
    password: hashPassword(password),
    name: body.name || email.split('@')[0],
    phone: body.phone || '',
    role: role === 'fleet_manager' ? 'fleet_manager' : role,
    company_id: auth.company_id,
    permissions,
    active: true,
    created_by: auth.id,
    created_at: now()
  };
  users.push(user);
  write('users', users);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions,
    phone: user.phone,
    active: true,
    temp_password: body.password ? undefined : password
  };
}

function updateCompanyUser(auth, id, body) {
  if (!canManageTeam(auth)) throw new Error('No permission to manage team');
  const users = read('users') || [];
  const idx = users.findIndex(u => u.id === id && u.company_id === auth.company_id);
  if (idx < 0) return null;
  // cannot demote yourself removing team access accidentally handled by UI
  if (body.name != null) users[idx].name = body.name;
  if (body.phone != null) users[idx].phone = body.phone;
  if (body.role != null && body.role !== 'platform_admin') users[idx].role = body.role;
  if (body.permissions) users[idx].permissions = body.permissions;
  if (body.active != null) users[idx].active = !!body.active;
  if (body.password) users[idx].password = hashPassword(body.password);
  write('users', users);
  const u = users[idx];
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    permissions: u.permissions, phone: u.phone, active: u.active !== false
  };
}

function deleteCompanyUser(auth, id) {
  if (!canManageTeam(auth)) throw new Error('No permission to manage team');
  if (id === auth.id) throw new Error('Cannot delete yourself');
  let users = read('users') || [];
  const before = users.length;
  users = users.filter(u => !(u.id === id && u.company_id === auth.company_id));
  if (users.length === before) return false;
  write('users', users);
  return true;
}

function getPresets() {
  return ROLE_PRESETS;
}

module.exports = {
  listCompanyUsers,
  createCompanyUser,
  updateCompanyUser,
  deleteCompanyUser,
  canManageTeam,
  getPresets,
  ROLE_PRESETS
};
