/**
 * Mlimani AI integration layer.
 * REST endpoints remain the source of truth; MCP exposes tenant-scoped tools.
 * All write requests are staged for approval by the company's owner.
 */
const crypto = require('crypto');
const { read, write, uid, now } = require('./db');
const mod = require('./modules');
const fin = require('./finance');
const inv = require('./inventory');
const exp = require('./expenses');

const SERVER_INFO = { name: 'mlimani-ai-connector', version: '1.0.0' };
const PROTOCOL_VERSION = '2025-03-26';
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

const TOOL_DEFINITIONS = [
  ['mlimani_list_vehicles', 'List vehicles belonging to the signed-in company.', 'vehicles'],
  ['mlimani_list_drivers', 'List drivers belonging to the signed-in company.', 'drivers'],
  ['mlimani_list_trips', 'List trips belonging to the signed-in company.', 'trips'],
  ['mlimani_list_maintenance', 'List maintenance records belonging to the signed-in company.', 'maintenance'],
  ['mlimani_list_fuel', 'List fuel logs and fuel summary for the signed-in company.', 'fuel'],
  ['mlimani_list_inventory', 'List spare-parts inventory and warehouse summary.', 'inventory'],
  ['mlimani_list_expenses', 'List operating expenses for the signed-in company.', 'finance'],
  ['mlimani_list_invoices', 'List customer invoices and receivables.', 'finance'],
  ['mlimani_list_loans', 'List supplier loans and payables.', 'finance'],
  ['mlimani_finance_summary', 'Get the signed-in company financial summary.', 'finance'],
  ['mlimani_dashboard', 'Get operational dashboard counts for the signed-in company.', 'reports'],
  ['mlimani_request_write_approval', 'Submit a proposed expense, trip, or customer invoice. It will NOT be saved until a company owner approves it.', 'write']
].map(([name, description, permission]) => ({ name, description, permission }));

function isOwner(auth) {
  return ['fleet_manager', 'company_admin', 'platform_admin'].includes(auth.role);
}

function tenantAuth(auth) {
  if (!auth || !auth.company_id) throw new Error('This integration requires a company-linked user account.');
  return { ...auth, role: 'fleet_manager' };
}

function canRead(auth, permission) {
  if (!auth || !auth.company_id) return false;
  if (permission === 'write') return isOwner(auth);
  return !auth.permissions || auth.permissions[permission] !== false;
}

function tenantList(collection, auth) {
  return (read(collection) || []).filter(item => item.company_id === auth.company_id);
}

function safeApproval(item) {
  return {
    id: item.id,
    operation: item.operation,
    payload: item.payload,
    status: item.status,
    requested_at: item.requested_at,
    expires_at: item.expires_at,
    approved_at: item.approved_at || null,
    rejected_at: item.rejected_at || null
  };
}

function listApprovals(auth) {
  const scoped = tenantAuth(auth);
  return tenantList('integration_approvals', scoped)
    .filter(item => item.status === 'pending' && new Date(item.expires_at).getTime() > Date.now())
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
    .map(safeApproval);
}

function requestApproval(auth, args) {
  const scoped = tenantAuth(auth);
  if (!isOwner(auth)) throw new Error('Only a company owner or platform administrator can request AI write actions.');
  const operation = String(args.operation || '');
  const allowed = ['create_expense', 'create_trip', 'create_invoice'];
  if (!allowed.includes(operation)) throw new Error('Unsupported write operation.');
  if (!args.payload || typeof args.payload !== 'object' || Array.isArray(args.payload)) {
    throw new Error('A payload object is required.');
  }
  const approvals = read('integration_approvals') || [];
  const item = {
    id: uid(),
    company_id: scoped.company_id,
    operation,
    payload: args.payload,
    status: 'pending',
    requested_by: auth.id,
    requested_at: now(),
    expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
  };
  approvals.push(item);
  write('integration_approvals', approvals);
  return {
    approval_id: item.id,
    status: 'pending',
    message: 'No business record has been changed. A company owner must approve this request through the authenticated approvals endpoint.',
    approval_endpoint: '/api/integrations/approvals/' + item.id + '/approve',
    expires_at: item.expires_at
  };
}

function executeApproved(auth, item) {
  const scoped = tenantAuth(auth);
  const payload = item.payload || {};
  if (item.operation === 'create_expense') return exp.createExpense(scoped, payload);
  if (item.operation === 'create_trip') return mod.createTrip(scoped, payload);
  if (item.operation === 'create_invoice') return fin.createInvoice(scoped, payload);
  throw new Error('Unsupported approved operation.');
}

function approve(auth, id) {
  const scoped = tenantAuth(auth);
  if (!isOwner(auth)) throw new Error('Only the company owner can approve AI write actions.');
  const approvals = read('integration_approvals') || [];
  const index = approvals.findIndex(x => x.id === id && x.company_id === scoped.company_id);
  if (index < 0) return { status: 404, body: { error: 'Approval not found' } };
  const item = approvals[index];
  if (item.status !== 'pending') return { status: 409, body: { error: 'Approval is no longer pending', status: item.status } };
  if (new Date(item.expires_at).getTime() < Date.now()) {
    item.status = 'expired';
    write('integration_approvals', approvals);
    return { status: 410, body: { error: 'Approval expired' } };
  }
  try {
    const result = executeApproved(scoped, item);
    item.status = 'approved';
    item.approved_at = now();
    item.approved_by = auth.id;
    item.result_id = result && result.id ? result.id : null;
    item.result_type = item.operation;
    write('integration_approvals', approvals);
    return { status: 200, body: { status: item.status, operation: item.operation, result } };
  } catch (error) {
    return { status: 400, body: { error: error.message } };
  }
}

function reject(auth, id) {
  const scoped = tenantAuth(auth);
  if (!isOwner(auth)) throw new Error('Only the company owner can reject AI write actions.');
  const approvals = read('integration_approvals') || [];
  const index = approvals.findIndex(x => x.id === id && x.company_id === scoped.company_id);
  if (index < 0) return { status: 404, body: { error: 'Approval not found' } };
  if (approvals[index].status !== 'pending') return { status: 409, body: { error: 'Approval is no longer pending' } };
  approvals[index].status = 'rejected';
  approvals[index].rejected_at = now();
  approvals[index].rejected_by = auth.id;
  write('integration_approvals', approvals);
  return { status: 200, body: { status: 'rejected' } };
}

function dashboard(auth) {
  const vehicles = tenantList('vehicles', auth);
  const drivers = tenantList('drivers', auth);
  const trips = mod.listTrips(auth);
  const maintenance = mod.listMaintenance(auth);
  const fuel = mod.listFuel(auth);
  return {
    vehicles: vehicles.length,
    drivers: drivers.length,
    active_trips: trips.filter(x => ['in_progress', 'active', 'on_route'].includes(String(x.status || '').toLowerCase())).length,
    maintenance_due: maintenance.filter(x => ['overdue', 'scheduled', 'due'].includes(String(x.status || '').toLowerCase())).length,
    fuel_logs: fuel.length
  };
}

function runTool(auth, name, args) {
  const definition = TOOL_DEFINITIONS.find(tool => tool.name === name);
  if (!definition) throw new Error('Unknown Mlimani tool: ' + name);
  if (!canRead(auth, definition.permission)) throw new Error('Your account does not have permission for this tool.');
  const scoped = tenantAuth(auth);
  switch (name) {
    case 'mlimani_list_vehicles': return { vehicles: tenantList('vehicles', scoped) };
    case 'mlimani_list_drivers': return { drivers: tenantList('drivers', scoped) };
    case 'mlimani_list_trips': return { trips: mod.listTrips(scoped) };
    case 'mlimani_list_maintenance': return { items: mod.listMaintenance(scoped) };
    case 'mlimani_list_fuel': return { logs: mod.listFuel(scoped), summary: mod.fuelSummary(scoped) };
    case 'mlimani_list_inventory': return { parts: inv.listParts(scoped), moves: inv.listMoves(scoped, 100), summary: inv.warehouseSummary(scoped) };
    case 'mlimani_list_expenses': return { expenses: exp.listExpenses(scoped) };
    case 'mlimani_list_invoices': return { invoices: fin.listInvoices(scoped) };
    case 'mlimani_list_loans': return { loans: fin.listLoans(scoped) };
    case 'mlimani_finance_summary': return fin.financeSummary(scoped);
    case 'mlimani_dashboard': return dashboard(scoped);
    case 'mlimani_request_write_approval': return requestApproval(auth, args);
    default: throw new Error('Tool is not available.');
  }
}

function mcpToolList(auth) {
  return TOOL_DEFINITIONS.filter(tool => canRead(auth, tool.permission)).map(({ name, description }) => ({
    name,
    description,
    inputSchema: name === 'mlimani_request_write_approval'
      ? {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['create_expense', 'create_trip', 'create_invoice'] },
            payload: { type: 'object', description: 'Fields required by the selected Mlimani operation.' }
          },
          required: ['operation', 'payload'],
          additionalProperties: false
        }
      : { type: 'object', properties: {}, additionalProperties: false }
  }));
}

function jsonRpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

async function handle(req, res, pathname, context) {
  const { getAuth, send, body = {} } = context;
  if (!pathname.startsWith('/api/mcp') && !pathname.startsWith('/api/integrations/')) return false;
  const auth = getAuth(req);
  if (!auth) {
    send(res, 401, { error: 'Unauthorized. Use a Mlimani user access token in the Authorization: Bearer header.' });
    return true;
  }
  try { tenantAuth(auth); }
  catch (error) { send(res, 403, { error: error.message }); return true; }

  if (pathname === '/api/integrations/status' && req.method === 'GET') {
    send(res, 200, { name: 'Mlimani AI integration', version: '1.0.0', rest_api: true, mcp: true, tenant_scoped: true, write_policy: 'company-owner approval required', mcp_endpoint: '/api/mcp' });
    return true;
  }
  if (pathname === '/api/integrations/openapi.json' && req.method === 'GET') {
    send(res, 200, {
      openapi: '3.1.0',
      info: { title: 'Mlimani REST API', version: '1.0.0', description: 'Use the existing authenticated Mlimani REST endpoints. All company records are scoped to the signed-in company.' },
      servers: [{ url: '/api' }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Mlimani JWT' } } },
      security: [{ bearerAuth: [] }],
      paths: {
        '/vehicles': { get: { summary: 'List company vehicles' }, post: { summary: 'Create vehicle' } },
        '/drivers': { get: { summary: 'List company drivers' }, post: { summary: 'Create driver' } },
        '/trips': { get: { summary: 'List company trips' }, post: { summary: 'Create trip' } },
        '/maintenance': { get: { summary: 'List maintenance' }, post: { summary: 'Create maintenance record' } },
        '/fuel': { get: { summary: 'List fuel logs' }, post: { summary: 'Create fuel log' } },
        '/inventory': { get: { summary: 'List inventory' }, post: { summary: 'Create inventory part' } },
        '/expenses': { get: { summary: 'List expenses' }, post: { summary: 'Create expense' } },
        '/invoices': { get: { summary: 'List invoices' }, post: { summary: 'Create invoice' } },
        '/loans': { get: { summary: 'List supplier loans' }, post: { summary: 'Create supplier loan' } },
        '/finance/summary': { get: { summary: 'Company finance summary' } },
        '/dashboard': { get: { summary: 'Company dashboard' } }
      }
    });
    return true;
  }
  if (pathname === '/api/integrations/approvals' && req.method === 'GET') {
    if (!isOwner(auth)) { send(res, 403, { error: 'Company owner permission required' }); return true; }
    send(res, 200, { approvals: listApprovals(auth) });
    return true;
  }
  const approvalMatch = pathname.match(/^\/api\/integrations\/approvals\/([^/]+)\/(approve|reject)$/);
  if (approvalMatch && req.method === 'POST') {
    const result = approvalMatch[2] === 'approve' ? approve(auth, approvalMatch[1]) : reject(auth, approvalMatch[1]);
    send(res, result.status, result.body);
    return true;
  }

  if (pathname === '/api/mcp' && req.method === 'POST') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'Invalid JSON-RPC body' }); return true; }
    const id = body.id;
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      send(res, 400, { error: 'Invalid JSON-RPC 2.0 request' }); return true;
    }
    if (body.method === 'notifications/initialized' || body.method === 'notifications/cancelled') {
      res.writeHead(202, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
      res.end();
      return true;
    }
    if (body.method === 'initialize') {
      send(res, 200, jsonRpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Mlimani data is restricted to the authenticated user company. Read tools are available according to user permissions. Write proposals require separate approval by a company owner through the Mlimani approvals REST endpoint.'
      }));
      return true;
    }
    if (body.method === 'ping') { send(res, 200, jsonRpc(id, {})); return true; }
    if (body.method === 'tools/list') {
      send(res, 200, jsonRpc(id, { tools: mcpToolList(auth) }));
      return true;
    }
    if (body.method === 'tools/call') {
      const params = body.params || {};
      try {
        const result = runTool(auth, params.name, params.arguments || {});
        send(res, 200, jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }));
      } catch (error) {
        send(res, 200, jsonRpc(id, { content: [{ type: 'text', text: error.message }], isError: true }));
      }
      return true;
    }
    send(res, 200, { jsonrpc: '2.0', id: id == null ? null : id, error: { code: -32601, message: 'Method not found' } });
    return true;
  }

  send(res, 405, { error: 'Method not allowed' });
  return true;
}

module.exports = { handle, TOOL_DEFINITIONS };
