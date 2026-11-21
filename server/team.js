/**
 * Company team: sub-users with permissions
 * Roles: fleet_manager (owner), dispatcher, accountant, workshop, viewer, custom
 */
const { read, write, uid, now } = require('./db');
const { hashPassword } = require('./auth');
const crypto = require('crypto');

const ROLE_PRESETS = {
  fleet_manager: {
    label: 'Company Owner',
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
  company_admin: {
    label: 'Company Admin',
    permissions: {
      vehicles: true, drivers: true, trips: true, maintenance: true, fuel: true,
      finance: true, gps: true, inventory: true, reports: true, billing: false, team: true
    }
  },
  operations: {
    label: 'Operations',
    permissions: {
      vehicles: true, drivers: true, trips: true, maintenance: true, fuel: true,
      finance: false, gps: true, inventory: false, reports: true, billing: false, team: false
    }
  },
  warehouse_officer: {
    label: 'Warehouse Officer',
    permissions: {
      vehicles: false, drivers: false, trips: false, maintenance: false, fuel: false,
      finance: false, gps: false, inventory: true, reports: false, billing: false, team: false
    }
  },
  driver: {
    label: 'Driver',
    permissions: {
      vehicles: false, drivers: false, trips: true, maintenance: false, fuel: false,
      finance: false, gps: true, inventory: false, reports: false, billing: false, team: false
    }
  },
  auditor: {
    label: 'Auditor',
    permissions: {
      vehicles: true, drivers: true, trips: true, maintenance: true, fuel: true,
      finance: true, gps: true, inventory: true, reports: true, billing: false, team: false
    }
  },
  custom: {
    label: 'Custom Permissions',
    permissions: {
      vehicles: false, drivers: false, trips: false, maintenance: false, fuel: false,
      finance: false, gps: false, inventory: false, reports: false, billing: false, team: false
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
  if (!auth || !auth.company_id) return false;
  return auth.role === 'fleet_manager' || auth.role === 'company_admin';
}

function normalizePermissions(role, supplied) {
  const allowed = ['vehicles','drivers','trips','maintenance','fuel','finance','gps','inventory','reports','billing','team'];
  const preset = ROLE_PRESETS[role]?.permissions || ROLE_PRESETS.viewer.permissions;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return { ...preset };
  return Object.fromEntries(allowed.map(key => [key, supplied[key] === true]));
}

function createCompanyUser(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  if (!canManageTeam(auth)) throw new Error('No permission to manage team');

  const email = (body.email || '').toLowerCase().trim();
  if (!email) throw new Error('Email required');
  const password = body.password || crypto.randomBytes(9).toString('base64url');
  if (String(password).length < 10) throw new Error('Password must be at least 10 characters');

  const users = read('users') || [];
  if (users.find(u => u.email === email)) throw new Error('Email already registered');

  const role = body.role || 'viewer';
  if (!ROLE_PRESETS[role] || role === 'platform_admin' || role === 'fleet_manager') throw new Error('Invalid company role');

  if (role === 'company_admin' && auth.role !== 'fleet_manager') {
    throw new Error('Only the company owner can appoint a Company Admin');
  }
  const permissions = normalizePermissions(role, body.permissions);

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
  if (id === auth.id && (body.role != null || body.permissions != null)) {
    throw new Error('You cannot change your own role or permissions');
  }
  if (users[idx].role === 'fleet_manager' && auth.role !== 'fleet_manager') {
    throw new Error('Only the company owner can manage the owner account');
  }
  if (users[idx].role === 'company_admin' && auth.role !== 'fleet_manager') {
    throw new Error('Only the company owner can manage a Company Admin');
  }
  if (body.name != null) users[idx].name = body.name;
  if (body.phone != null) users[idx].phone = body.phone;
  if (body.role != null) {
    if (!ROLE_PRESETS[body.role] || body.role === 'fleet_manager') throw new Error('Invalid company role');
    if (body.role === 'company_admin' && auth.role !== 'fleet_manager') {
      throw new Error('Only the company owner can appoint a Company Admin');
    }
    if (users[idx].role === 'company_admin' && auth.role !== 'fleet_manager') {
      throw new Error('Only the company owner can manage a Company Admin');
    }
    users[idx].role = body.role;
    users[idx].permissions = normalizePermissions(body.role, body.permissions || ROLE_PRESETS[body.role].permissions);
  } else if (body.permissions) {
    users[idx].permissions = normalizePermissions(users[idx].role, body.permissions);
  }
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
  const target = users.find(u => u.id === id && u.company_id === auth.company_id);
  if (target && ['fleet_manager', 'company_admin'].includes(target.role) && auth.role !== 'fleet_manager') {
    throw new Error('Only the company owner can delete a Company Admin or owner account');
  }
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
