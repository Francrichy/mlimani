/**
 * Odometer-based maintenance rules (engine oil, filters, etc.)
 */
const { read, write, uid, now } = require('./db');

const DEFAULT_RULES = [
  { type: 'engine_oil', label: 'Engine oil change', interval_km: 10000 },
  { type: 'oil_filter', label: 'Oil filter', interval_km: 10000 },
  { type: 'air_filter', label: 'Air filter', interval_km: 20000 },
  { type: 'fuel_filter', label: 'Fuel filter', interval_km: 20000 },
  { type: 'tyre_rotation', label: 'Tyre rotation / check', interval_km: 15000 },
  { type: 'brake_inspection', label: 'Brake inspection', interval_km: 25000 },
  { type: 'full_service', label: 'Full service', interval_km: 40000 }
];

function companyFilter(list, auth) {
  if (!list) return [];
  if (auth.role === 'platform_admin') return list;
  return list.filter(x => x.company_id === auth.company_id);
}

function getRules(auth) {
  let rules = companyFilter(read('maint_rules') || [], auth);
  if (!rules.length && auth.company_id) {
    rules = DEFAULT_RULES.map(r => ({
      id: uid(), company_id: auth.company_id, ...r, active: true, created_at: now()
    }));
    write('maint_rules', [...(read('maint_rules') || []), ...rules]);
  }
  return rules.filter(r => r.active !== false);
}

function vehicleDueList(auth) {
  const vehicles = companyFilter(read('vehicles') || [], auth);
  const rules = getRules(auth);
  const maint = companyFilter(read('maintenance') || [], auth);
  const results = [];

  for (const v of vehicles) {
    const odo = Number(v.odometer) || 0;
    for (const rule of rules) {
      // last completed service of this type for vehicle
      const done = maint
        .filter(m => m.vehicle_id === v.id && m.type === rule.type && m.status === 'completed')
        .sort((a, b) => (b.completed_odometer || 0) - (a.completed_odometer || 0))[0];
      const lastOdo = done ? Number(done.completed_odometer) || 0 : 0;
      const nextDueOdo = lastOdo + (rule.interval_km || 10000);
      const kmLeft = nextDueOdo - odo;
      let status = 'ok';
      if (kmLeft <= 0) status = 'overdue';
      else if (kmLeft <= 1000) status = 'due_soon';
      results.push({
        vehicle_id: v.id,
        plate: v.plate,
        rule_type: rule.type,
        label: rule.label,
        interval_km: rule.interval_km,
        current_odometer: odo,
        last_service_odometer: lastOdo || null,
        next_due_odometer: nextDueOdo,
        km_remaining: kmLeft,
        status
      });
    }
  }
  return results.sort((a, b) => a.km_remaining - b.km_remaining);
}

module.exports = { getRules, vehicleDueList, DEFAULT_RULES };
