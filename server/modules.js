/**
 * Maintenance, Fuel, Trips modules
 */
const { read, write, uid, now } = require('./db');

function companyFilter(list, auth) {
  if (auth.role === 'platform_admin') return list;
  return list.filter(x => x.company_id === auth.company_id);
}

// ---------- TRIPS ----------
function listTrips(auth) {
  return companyFilter(read('trips') || [], auth);
}

function createTrip(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  const trip = {
    id: uid(),
    company_id: auth.company_id,
    vehicle_id: body.vehicle_id || null,
    driver_id: body.driver_id || null,
    type: body.type === 'daladala' ? 'daladala' : 'long_haul',
    origin: body.origin || '',
    destination: body.destination || '',
    status: body.status || 'planned',
    started_at: body.started_at || null,
    ended_at: body.ended_at || null,
    distance_km: body.distance_km || 0,
    revenue_tzs: body.revenue_tzs || 0,
    notes: body.notes || '',
    created_at: now()
  };
  const all = read('trips') || [];
  all.push(trip);
  write('trips', all);
  return trip;
}

function updateTrip(auth, id, body) {
  const all = read('trips') || [];
  const idx = all.findIndex(t => t.id === id && (auth.role === 'platform_admin' || t.company_id === auth.company_id));
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...body, id: all[idx].id, company_id: all[idx].company_id };
  write('trips', all);
  return all[idx];
}

// ---------- MAINTENANCE ----------
function listMaintenance(auth) {
  return companyFilter(read('maintenance') || [], auth);
}

function createMaintenance(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  const item = {
    id: uid(),
    company_id: auth.company_id,
    vehicle_id: body.vehicle_id || null,
    type: body.type || 'service',
    description: body.description || '',
    status: body.status || 'scheduled',
    priority: body.priority || 'medium',
    due_date: body.due_date || null,
    due_odometer: body.due_odometer || null,
    cost_tzs: body.cost_tzs || 0,
    completed_at: null,
    created_at: now()
  };
  const all = read('maintenance') || [];
  all.push(item);
  write('maintenance', all);
  return item;
}

function updateMaintenance(auth, id, body) {
  const all = read('maintenance') || [];
  const idx = all.findIndex(t => t.id === id && (auth.role === 'platform_admin' || t.company_id === auth.company_id));
  if (idx < 0) return null;
  if (body.status === 'completed' && !all[idx].completed_at) body.completed_at = now();
  all[idx] = { ...all[idx], ...body, id: all[idx].id, company_id: all[idx].company_id };
  write('maintenance', all);
  return all[idx];
}

// ---------- FUEL ----------
function listFuel(auth) {
  return companyFilter(read('fuel_logs') || [], auth);
}

function createFuel(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  if (!body.vehicle_id) throw new Error('Select a vehicle / truck');
  const liters = Number(body.liters) || 0;
  if (liters <= 0) throw new Error('Enter litres filled');
  let pricePerLiter = Number(body.price_per_liter);
  if (!pricePerLiter || pricePerLiter <= 0) {
    // fallback: if only total cost given
    const totalOnly = Number(body.cost_tzs) || 0;
    if (totalOnly > 0 && liters > 0) pricePerLiter = totalOnly / liters;
  }
  if (!pricePerLiter || pricePerLiter <= 0) throw new Error('Enter fuel price per litre (TZS)');
  const cost_tzs = Math.round(liters * pricePerLiter);
  const log = {
    id: uid(),
    company_id: auth.company_id,
    vehicle_id: body.vehicle_id || null,
    liters,
    price_per_liter: pricePerLiter,
    cost_tzs,
    odometer: Number(body.odometer) || 0,
    station: body.station || '',
    location: body.location || '',
    filled_at: body.filled_at || now().slice(0, 10),
    notes: body.notes || '',
    created_at: now()
  };
  const all = read('fuel_logs') || [];
  all.push(log);
  write('fuel_logs', all);
  // bump vehicle odometer if higher
  if (log.vehicle_id && log.odometer) {
    const vehicles = read('vehicles');
    const vi = vehicles.findIndex(v => v.id === log.vehicle_id);
    if (vi >= 0 && log.odometer > (vehicles[vi].odometer || 0)) {
      vehicles[vi].odometer = log.odometer;
      write('vehicles', vehicles);
    }
  }
  return log;
}

function fuelSummary(auth) {
  const logs = listFuel(auth);
  const totalLiters = logs.reduce((s, l) => s + (l.liters || 0), 0);
  const totalCost = logs.reduce((s, l) => s + (l.cost_tzs || 0), 0);
  const month = now().slice(0, 7);
  const mtd = logs.filter(l => (l.filled_at || '').startsWith(month));
  return {
    total_liters: totalLiters,
    total_cost_tzs: totalCost,
    mtd_liters: mtd.reduce((s, l) => s + (l.liters || 0), 0),
    mtd_cost_tzs: mtd.reduce((s, l) => s + (l.cost_tzs || 0), 0),
    count: logs.length
  };
}

function seedModules(companyId) {
  if ((read('trips') || []).length) return;
  const vehicles = read('vehicles').filter(v => v.company_id === companyId);
  const drivers = read('drivers').filter(d => d.company_id === companyId);
  const v1 = vehicles[0]?.id, v2 = vehicles[1]?.id, d1 = drivers[0]?.id;

  write('trips', [
    { id: uid(), company_id: companyId, vehicle_id: v1, driver_id: d1, type: 'long_haul', origin: 'Dar es Salaam', destination: 'Arusha', status: 'completed', started_at: '2026-10-18T06:00:00Z', ended_at: '2026-10-18T14:42:00Z', distance_km: 580, revenue_tzs: 1800000, notes: '', created_at: now() },
    { id: uid(), company_id: companyId, vehicle_id: v2, driver_id: drivers[1]?.id, type: 'daladala', origin: 'Mwenge', destination: 'Kariakoo', status: 'in_progress', started_at: '2026-10-21T05:30:00Z', ended_at: null, distance_km: 12, revenue_tzs: 0, notes: 'Morning shift', created_at: now() }
  ]);
  write('maintenance', [
    { id: uid(), company_id: companyId, vehicle_id: vehicles[2]?.id || v1, type: 'full_service', description: 'Full service — overdue interval', status: 'overdue', priority: 'high', due_date: '2026-10-19', due_odometer: 142800, cost_tzs: 0, completed_at: null, created_at: now() },
    { id: uid(), company_id: companyId, vehicle_id: v2, type: 'tyre_rotation', description: 'Tyre rotation', status: 'scheduled', priority: 'medium', due_date: '2026-10-26', due_odometer: 90000, cost_tzs: 0, completed_at: null, created_at: now() }
  ]);
  write('fuel_logs', [
    { id: uid(), company_id: companyId, vehicle_id: v1, liters: 180, cost_tzs: 540000, odometer: 142500, station: 'PUMA Ubungo', filled_at: '2026-10-17', created_at: now() },
    { id: uid(), company_id: companyId, vehicle_id: v2, liters: 45, cost_tzs: 135000, odometer: 89100, station: 'Shell Mwenge', filled_at: '2026-10-20', created_at: now() }
  ]);
  write('notification_logs', []);
}

module.exports = {
  listTrips, createTrip, updateTrip,
  listMaintenance, createMaintenance, updateMaintenance,
  listFuel, createFuel, fuelSummary,
  seedModules
};
