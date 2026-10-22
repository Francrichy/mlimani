/**
 * Warehouse — parts store for fleet storeman
 * Receive (stock in), Issue (stock out to vehicle/job), movement history
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

function listMoves(auth, limit = 100) {
  const moves = companyFilter(read('inventory_moves') || [], auth);
  return moves.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, limit);
}

function createPart(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  if (!(body.name || '').trim()) throw new Error('Part name required');
  const part = {
    id: uid(),
    company_id: auth.company_id,
    sku: (body.sku || `SKU-${Date.now().toString().slice(-5)}`).trim(),
    name: (body.name || '').trim(),
    category: body.category || 'general',
    stock: 0, // always start at 0 — use Receive to add quantity
    min_stock: Number(body.min_stock) || 0,
    unit: (body.unit || 'pcs').trim() || 'pcs',
    unit_cost_tzs: Number(body.unit_cost_tzs) || 0,
    supplier_name: body.supplier_name || '',
    location: body.location || 'Main store',
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
  const allowed = ['sku','name','category','min_stock','unit','unit_cost_tzs','supplier_name','notes','location'];
  for (const k of allowed) if (body[k] !== undefined) all[idx][k] = body[k];
  all[idx].updated_at = now();
  write('inventory_parts', all);
  return all[idx];
}

function recordMove(auth, data) {
  const moves = read('inventory_moves') || [];
  const move = {
    id: uid(),
    company_id: auth.company_id || data.company_id,
    part_id: data.part_id,
    type: data.type || (data.delta >= 0 ? 'receive' : 'issue'),
    qty: Math.abs(Number(data.qty != null ? data.qty : data.delta) || 0),
    delta: Number(data.delta) || 0,
    vehicle_id: data.vehicle_id || null,
    vehicle_plate: data.vehicle_plate || '',
    issued_to: data.issued_to || '', // storeman / mechanic name
    reason: data.reason || '',
    reference: data.reference || '',
    stock_after: data.stock_after,
    created_by: auth.id || null,
    created_at: now()
  };
  moves.push(move);
  write('inventory_moves', moves.slice(-3000));
  return move;
}

function adjustStock(auth, id, delta, reason) {
  return receiveOrIssue(auth, {
    part_id: id,
    qty: Math.abs(Number(delta) || 0),
    type: Number(delta) >= 0 ? 'receive' : 'issue',
    reason: reason || (Number(delta) >= 0 ? 'Stock adjustment in' : 'Stock adjustment out')
  });
}

/** Receive stock into warehouse */
function receiveStock(auth, body) {
  return receiveOrIssue(auth, {
    part_id: body.part_id,
    qty: Number(body.qty) || 0,
    type: 'receive',
    reason: body.reason || 'Goods received',
    reference: body.reference || '',
    issued_to: body.received_by || ''
  });
}

/** Issue parts from warehouse to vehicle / job */
function issueStock(auth, body) {
  const qty = Number(body.qty) || 0;
  if (qty <= 0) throw new Error('Quantity must be greater than 0');
  return receiveOrIssue(auth, {
    part_id: body.part_id,
    qty,
    type: 'issue',
    vehicle_id: body.vehicle_id || null,
    vehicle_plate: body.vehicle_plate || '',
    issued_to: body.issued_to || '',
    reason: body.reason || 'Issued to vehicle',
    reference: body.reference || body.job_ref || ''
  });
}

function receiveOrIssue(auth, opts) {
  const all = read('inventory_parts') || [];
  const idx = all.findIndex(p => p.id === opts.part_id && (auth.role === 'platform_admin' || p.company_id === auth.company_id));
  if (idx < 0) throw new Error('Part not found');

  const qty = Math.abs(Number(opts.qty) || 0);
  if (qty <= 0) throw new Error('Quantity required');

  let delta = opts.type === 'issue' ? -qty : qty;
  const current = Number(all[idx].stock) || 0;
  if (opts.type === 'issue' && current < qty) {
    throw new Error(`Insufficient stock. Available: ${current} ${all[idx].unit || ''}`);
  }

  all[idx].stock = current + delta;
  all[idx].updated_at = now();
  write('inventory_parts', all);

  const move = recordMove(auth, {
    part_id: opts.part_id,
    type: opts.type,
    qty,
    delta,
    vehicle_id: opts.vehicle_id,
    vehicle_plate: opts.vehicle_plate,
    issued_to: opts.issued_to,
    reason: opts.reason,
    reference: opts.reference,
    stock_after: all[idx].stock
  });

  return { part: all[idx], move };
}

function deletePart(auth, id) {
  let all = read('inventory_parts') || [];
  const before = all.length;
  all = all.filter(p => !(p.id === id && (auth.role === 'platform_admin' || p.company_id === auth.company_id)));
  write('inventory_parts', all);
  return all.length < before;
}

function warehouseSummary(auth) {
  const parts = listParts(auth);
  const moves = listMoves(auth, 500);
  const low = parts.filter(p => p.stock <= p.min_stock);
  const value = parts.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.unit_cost_tzs) || 0), 0);
  const issuedToday = moves.filter(m => m.type === 'issue' && (m.created_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10));
  return {
    total_skus: parts.length,
    low_stock: low.length,
    stock_value_tzs: value,
    issues_today: issuedToday.length,
    qty_issued_today: issuedToday.reduce((s, m) => s + (m.qty || 0), 0)
  };
}

function seedInventory(companyId) {
  if ((read('inventory_parts') || []).some(p => p.company_id === companyId)) return;
  const parts = [
    { sku: 'OIL-15W40', name: 'Engine oil 15W-40 (20L)', category: 'oil', stock: 24, min_stock: 10, unit: 'drums', unit_cost_tzs: 185000, location: 'Shelf A1' },
    { sku: 'TYRE-295', name: 'Tyre 295/80R22.5', category: 'tyre', stock: 8, min_stock: 6, unit: 'pcs', unit_cost_tzs: 420000, location: 'Yard rack' },
    { sku: 'FILTER-AF', name: 'Air filter (Isuzu)', category: 'filter', stock: 15, min_stock: 5, unit: 'pcs', unit_cost_tzs: 45000, location: 'Shelf B2' },
    { sku: 'BRAKE-PAD', name: 'Brake pads set', category: 'brake', stock: 3, min_stock: 4, unit: 'sets', unit_cost_tzs: 95000, location: 'Shelf B1' },
    { sku: 'BAT-12V', name: 'Battery 12V 150Ah', category: 'battery', stock: 6, min_stock: 2, unit: 'pcs', unit_cost_tzs: 280000, location: 'Shelf C1' }
  ].map(p => ({ id: uid(), company_id: companyId, ...p, supplier_name: '', notes: '', created_at: now(), updated_at: now() }));
  write('inventory_parts', [...(read('inventory_parts') || []), ...parts]);
}

module.exports = {
  listParts, listMoves, createPart, updatePart, adjustStock,
  receiveStock, issueStock, deletePart, warehouseSummary, seedInventory
};
