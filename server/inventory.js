/**
 * Parts inventory — stock in/out, low-stock alerts
 */
const { read, write, uid, now } = require('./db');

function companyFilter(list, auth) {
  if (!list) return [];
  if (auth.role === 'platform_admin') return list;
  return list.filter(x => x.company_id === auth.company_id);
}

function listParts(auth) {
  return companyFilter(read('inventory_parts') || [], auth);
}

function createPart(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  const part = {
    id: uid(),
    company_id: auth.company_id,
    sku: body.sku || `SKU-${Date.now().toString().slice(-5)}`,
    name: body.name || '',
    category: body.category || 'general', // oil, tyre, filter, brake, battery, other
    stock: Number(body.stock) || 0,
    min_stock: Number(body.min_stock) || 0,
    unit: body.unit || 'pcs',
    unit_cost_tzs: Number(body.unit_cost_tzs) || 0,
    supplier_name: body.supplier_name || '',
    notes: body.notes || '',
    created_at: now(),
    updated_at: now()
  };
  const all = read('inventory_parts') || [];
  all.push(part);
  write('inventory_parts', all);
  return part;
}

function updatePart(auth, id, body) {
  const all = read('inventory_parts') || [];
  const idx = all.findIndex(p => p.id === id && (auth.role === 'platform_admin' || p.company_id === auth.company_id));
  if (idx < 0) return null;
  const allowed = ['sku','name','category','stock','min_stock','unit','unit_cost_tzs','supplier_name','notes'];
  for (const k of allowed) if (body[k] !== undefined) all[idx][k] = body[k];
  all[idx].updated_at = now();
  write('inventory_parts', all);
  return all[idx];
}

function adjustStock(auth, id, delta, reason) {
  const all = read('inventory_parts') || [];
  const idx = all.findIndex(p => p.id === id && (auth.role === 'platform_admin' || p.company_id === auth.company_id));
  if (idx < 0) return null;
  all[idx].stock = Math.max(0, (Number(all[idx].stock) || 0) + Number(delta));
  all[idx].updated_at = now();
  write('inventory_parts', all);
  const moves = read('inventory_moves') || [];
  moves.push({
    id: uid(), company_id: all[idx].company_id, part_id: id,
    delta: Number(delta), reason: reason || '', stock_after: all[idx].stock, created_at: now()
  });
  write('inventory_moves', moves.slice(-2000));
  return all[idx];
}

function deletePart(auth, id) {
  let all = read('inventory_parts') || [];
  const before = all.length;
  all = all.filter(p => !(p.id === id && (auth.role === 'platform_admin' || p.company_id === auth.company_id)));
  write('inventory_parts', all);
  return all.length < before;
}

function seedInventory(companyId) {
  if ((read('inventory_parts') || []).some(p => p.company_id === companyId)) return;
  const parts = [
    { sku: 'OIL-15W40', name: 'Engine oil 15W-40 (20L)', category: 'oil', stock: 24, min_stock: 10, unit: 'drums', unit_cost_tzs: 185000 },
    { sku: 'TYRE-295', name: 'Tyre 295/80R22.5', category: 'tyre', stock: 8, min_stock: 6, unit: 'pcs', unit_cost_tzs: 420000 },
    { sku: 'FILTER-AF', name: 'Air filter (Isuzu)', category: 'filter', stock: 15, min_stock: 5, unit: 'pcs', unit_cost_tzs: 45000 },
    { sku: 'BRAKE-PAD', name: 'Brake pads set', category: 'brake', stock: 3, min_stock: 4, unit: 'sets', unit_cost_tzs: 95000 },
    { sku: 'BAT-12V', name: 'Battery 12V 150Ah', category: 'battery', stock: 6, min_stock: 2, unit: 'pcs', unit_cost_tzs: 280000 }
  ].map(p => ({ id: uid(), company_id: companyId, ...p, supplier_name: '', notes: '', created_at: now(), updated_at: now() }));
  write('inventory_parts', [...(read('inventory_parts') || []), ...parts]);
}

module.exports = { listParts, createPart, updatePart, adjustStock, deletePart, seedInventory };
