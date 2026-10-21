/**
 * Finance: supplier loans (fuel/parts), client invoices & payment terms,
 * receivables, payables, P&L summary, due alerts
 */
const { read, write, uid, now } = require('./db');
const expensesMod = require('./expenses');

function companyFilter(list, auth) {
  if (!list) return [];
  if (auth.role === 'platform_admin') return list;
  return list.filter(x => x.company_id === auth.company_id);
}

function daysFrom(dateStr, days) {
  const d = new Date(dateStr || Date.now());
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- SUPPLIER LOANS (fuel / spare parts on credit) ----------
function listLoans(auth) {
  return companyFilter(read('supplier_loans') || [], auth);
}

function createLoan(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  const loanDate = body.loan_date || today();
  const termDays = Number(body.term_days) || 30;
  const loan = {
    id: uid(),
    company_id: auth.company_id,
    type: body.type === 'parts' ? 'parts' : 'fuel', // fuel | parts
    supplier_name: body.supplier_name || '',
    supplier_phone: body.supplier_phone || '',
    vehicle_id: body.vehicle_id || null,
    description: body.description || '',
    amount_tzs: Number(body.amount_tzs) || 0,
    amount_paid_tzs: Number(body.amount_paid_tzs) || 0,
    loan_date: loanDate,
    term_days: termDays,
    due_date: body.due_date || daysFrom(loanDate, termDays),
    status: 'open', // open | partial | paid | overdue
    notes: body.notes || '',
    created_at: now()
  };
  loan.balance_tzs = loan.amount_tzs - loan.amount_paid_tzs;
  const all = read('supplier_loans') || [];
  all.push(loan);
  write('supplier_loans', all);
  return loan;
}

function payLoan(auth, id, amount) {
  const all = read('supplier_loans') || [];
  const idx = all.findIndex(l => l.id === id && (auth.role === 'platform_admin' || l.company_id === auth.company_id));
  if (idx < 0) return null;
  const paid = Number(amount) || 0;
  all[idx].amount_paid_tzs = (all[idx].amount_paid_tzs || 0) + paid;
  all[idx].balance_tzs = all[idx].amount_tzs - all[idx].amount_paid_tzs;
  if (all[idx].balance_tzs <= 0) {
    all[idx].balance_tzs = 0;
    all[idx].status = 'paid';
    all[idx].paid_at = now();
  } else {
    all[idx].status = all[idx].due_date < today() ? 'overdue' : 'partial';
  }
  write('supplier_loans', all);
  return all[idx];
}

function refreshLoanStatuses(auth) {
  const all = read('supplier_loans') || [];
  let changed = false;
  const t = today();
  for (const l of all) {
    if (auth.company_id && l.company_id !== auth.company_id && auth.role !== 'platform_admin') continue;
    if (l.status === 'paid') continue;
    const bal = (l.amount_tzs || 0) - (l.amount_paid_tzs || 0);
    l.balance_tzs = bal;
    if (bal <= 0) { l.status = 'paid'; changed = true; }
    else if (l.due_date && l.due_date < t) { if (l.status !== 'overdue') { l.status = 'overdue'; changed = true; } }
  }
  if (changed) write('supplier_loans', all);
  return companyFilter(all, auth);
}

// ---------- CLIENT INVOICES / CARGO PAYMENTS ----------
// payment_terms: advance | on_delivery | credit_days
function listInvoices(auth) {
  return companyFilter(read('client_invoices') || [], auth);
}

function createInvoice(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  const terms = body.payment_terms || 'on_delivery'; // advance | on_delivery | credit_days
  const creditDays = Number(body.credit_days) || 0;
  const invDate = body.invoice_date || today();
  let dueDate = invDate;
  if (terms === 'credit_days') dueDate = daysFrom(invDate, creditDays);
  else if (terms === 'on_delivery') dueDate = body.delivery_date || invDate;

  const total = Number(body.total_tzs) || 0;
  const advance = Number(body.advance_tzs) || 0;
  const inv = {
    id: uid(),
    company_id: auth.company_id,
    invoice_no: body.invoice_no || `INV-${Date.now().toString().slice(-6)}`,
    client_name: body.client_name || '',
    client_phone: body.client_phone || '',
    vehicle_id: body.vehicle_id || null,
    trip_id: body.trip_id || null,
    description: body.description || '',
    origin: body.origin || '',
    destination: body.destination || '',
    total_tzs: total,
    advance_tzs: advance,
    amount_paid_tzs: advance, // advance counts as paid
    payment_terms: terms,
    credit_days: creditDays,
    invoice_date: invDate,
    delivery_date: body.delivery_date || null,
    due_date: dueDate,
    status: advance >= total ? 'paid' : (advance > 0 ? 'partial' : 'open'),
    notes: body.notes || '',
    created_at: now()
  };
  inv.balance_tzs = inv.total_tzs - inv.amount_paid_tzs;
  const all = read('client_invoices') || [];
  all.push(inv);
  write('client_invoices', all);
  return inv;
}

function recordClientPayment(auth, id, amount) {
  const all = read('client_invoices') || [];
  const idx = all.findIndex(i => i.id === id && (auth.role === 'platform_admin' || i.company_id === auth.company_id));
  if (idx < 0) return null;
  const paid = Number(amount) || 0;
  all[idx].amount_paid_tzs = (all[idx].amount_paid_tzs || 0) + paid;
  all[idx].balance_tzs = all[idx].total_tzs - all[idx].amount_paid_tzs;
  if (all[idx].balance_tzs <= 0) {
    all[idx].balance_tzs = 0;
    all[idx].status = 'paid';
    all[idx].paid_at = now();
  } else {
    all[idx].status = all[idx].due_date < today() ? 'overdue' : 'partial';
  }
  write('client_invoices', all);
  return all[idx];
}

function refreshInvoiceStatuses(auth) {
  const all = read('client_invoices') || [];
  const t = today();
  for (const i of all) {
    if (auth.company_id && i.company_id !== auth.company_id && auth.role !== 'platform_admin') continue;
    if (i.status === 'paid') continue;
    const bal = (i.total_tzs || 0) - (i.amount_paid_tzs || 0);
    i.balance_tzs = bal;
    if (bal <= 0) i.status = 'paid';
    else if (i.due_date && i.due_date < t) i.status = 'overdue';
  }
  write('client_invoices', all);
  return companyFilter(all, auth);
}

// ---------- SUMMARY: P&L, payables, receivables, dues ----------
function financeSummary(auth) {
  const loans = refreshLoanStatuses(auth);
  const invoices = refreshInvoiceStatuses(auth);
  const fuel = companyFilter(read('fuel_logs') || [], auth);
  const maint = companyFilter(read('maintenance') || [], auth);
  const trips = companyFilter(read('trips') || [], auth);

  // Payables = debt to suppliers (open loans)
  const payablesOpen = loans.filter(l => l.status !== 'paid');
  const debtToSuppliers = payablesOpen.reduce((s, l) => s + (l.balance_tzs || 0), 0);
  const fuelDebt = payablesOpen.filter(l => l.type === 'fuel').reduce((s, l) => s + (l.balance_tzs || 0), 0);
  const partsDebt = payablesOpen.filter(l => l.type === 'parts').reduce((s, l) => s + (l.balance_tzs || 0), 0);
  const overduePayables = payablesOpen.filter(l => l.status === 'overdue');

  // Receivables = debt from clients
  const recvOpen = invoices.filter(i => i.status !== 'paid');
  const debtFromClients = recvOpen.reduce((s, i) => s + (i.balance_tzs || 0), 0);
  const overdueReceivables = recvOpen.filter(i => i.status === 'overdue');

  // Revenue recognized (paid amounts + completed trip revenue)
  const revenueCollected = invoices.reduce((s, i) => s + (i.amount_paid_tzs || 0), 0);
  const tripRevenue = trips.reduce((s, t) => s + (t.revenue_tzs || 0), 0);
  const revenue = Math.max(revenueCollected, tripRevenue); // prefer invoices if present

  // Costs
  const fuelCost = fuel.reduce((s, f) => s + (f.cost_tzs || 0), 0);
  const maintCost = maint.reduce((s, m) => s + (m.cost_tzs || 0), 0);
  const loansPaid = loans.reduce((s, l) => s + (l.amount_paid_tzs || 0), 0);

  const opEx = expensesMod.totalExpenses(auth);
  const expenses = fuelCost + maintCost + opEx;
  const net = revenue - expenses;

  // Due soon (7 days)
  const t = today();
  const in7 = daysFrom(t, 7);
  const duesSoon = {
    supplier_loans: payablesOpen.filter(l => l.due_date && l.due_date <= in7),
    client_invoices: recvOpen.filter(i => i.due_date && i.due_date <= in7)
  };

  return {
    pnl: {
      revenue_tzs: revenue,
      fuel_cost_tzs: fuelCost,
      maintenance_cost_tzs: maintCost,
      operating_expenses_tzs: opEx,
      expenses_tzs: expenses,
      net_tzs: net,
      loans_repaid_tzs: loansPaid
    },
    payables: {
      total_tzs: debtToSuppliers,
      fuel_loan_tzs: fuelDebt,
      parts_loan_tzs: partsDebt,
      overdue_count: overduePayables.length,
      overdue_tzs: overduePayables.reduce((s, l) => s + (l.balance_tzs || 0), 0),
      items: payablesOpen
    },
    receivables: {
      total_tzs: debtFromClients,
      overdue_count: overdueReceivables.length,
      overdue_tzs: overdueReceivables.reduce((s, i) => s + (i.balance_tzs || 0), 0),
      items: recvOpen
    },
    dues_soon: duesSoon,
    alerts: [
      ...overduePayables.map(l => ({
        type: 'payable_overdue',
        severity: 'high',
        message: `${l.type === 'fuel' ? 'Fuel' : 'Parts'} loan to ${l.supplier_name || 'supplier'} overdue — TZS ${l.balance_tzs}`,
        due_date: l.due_date,
        id: l.id
      })),
      ...overdueReceivables.map(i => ({
        type: 'receivable_overdue',
        severity: 'high',
        message: `Client ${i.client_name || i.invoice_no} payment overdue — TZS ${i.balance_tzs}`,
        due_date: i.due_date,
        id: i.id
      })),
      ...duesSoon.supplier_loans.filter(l => l.status !== 'overdue').map(l => ({
        type: 'payable_due_soon',
        severity: 'medium',
        message: `${l.type === 'fuel' ? 'Fuel' : 'Parts'} loan due ${l.due_date} — TZS ${l.balance_tzs}`,
        due_date: l.due_date,
        id: l.id
      })),
      ...duesSoon.client_invoices.filter(i => i.status !== 'overdue').map(i => ({
        type: 'receivable_due_soon',
        severity: 'medium',
        message: `Loading/cargo payment due ${i.due_date} — ${i.client_name || i.invoice_no} TZS ${i.balance_tzs}`,
        due_date: i.due_date,
        id: i.id
      }))
    ]
  };
}

function seedFinance(companyId) {
  if ((read('supplier_loans') || []).length) return;
  const vehicles = (read('vehicles') || []).filter(v => v.company_id === companyId);
  const v1 = vehicles[0]?.id;

  write('supplier_loans', [
    {
      id: uid(), company_id: companyId, type: 'fuel', supplier_name: 'PUMA Ubungo', supplier_phone: '255712000111',
      vehicle_id: v1, description: 'Diesel 180L on credit', amount_tzs: 540000, amount_paid_tzs: 0, balance_tzs: 540000,
      loan_date: '2026-10-10', term_days: 14, due_date: '2026-10-24', status: 'open', notes: 'Repay after Dar-Arusha trip', created_at: now()
    },
    {
      id: uid(), company_id: companyId, type: 'parts', supplier_name: 'AutoParts DSM', supplier_phone: '255713000222',
      vehicle_id: vehicles[2]?.id || v1, description: 'Brake pads + air filter', amount_tzs: 140000, amount_paid_tzs: 50000, balance_tzs: 90000,
      loan_date: '2026-10-01', term_days: 30, due_date: '2026-10-31', status: 'partial', notes: '', created_at: now()
    }
  ]);

  write('client_invoices', [
    {
      id: uid(), company_id: companyId, invoice_no: 'INV-1042', client_name: 'Kilimanjaro Traders Ltd', client_phone: '255754999888',
      vehicle_id: v1, trip_id: null, description: 'Cargo Dar → Arusha', origin: 'Dar es Salaam', destination: 'Arusha',
      total_tzs: 1800000, advance_tzs: 500000, amount_paid_tzs: 500000, balance_tzs: 1300000,
      payment_terms: 'credit_days', credit_days: 14, invoice_date: '2026-10-18', delivery_date: '2026-10-18',
      due_date: '2026-11-01', status: 'partial', notes: '50% advance, balance 14 days after delivery', created_at: now()
    },
    {
      id: uid(), company_id: companyId, invoice_no: 'INV-1043', client_name: 'Mwanza Distributors', client_phone: '255755111222',
      vehicle_id: vehicles[0]?.id, description: 'Cargo Dar → Mwanza', origin: 'Dar', destination: 'Mwanza',
      total_tzs: 3200000, advance_tzs: 0, amount_paid_tzs: 0, balance_tzs: 3200000,
      payment_terms: 'on_delivery', credit_days: 0, invoice_date: '2026-10-15', delivery_date: '2026-10-20',
      due_date: '2026-10-20', status: 'overdue', notes: 'Pay on delivery — still outstanding', created_at: now()
    },
    {
      id: uid(), company_id: companyId, invoice_no: 'INV-1044', client_name: 'City Fresh Market', client_phone: '255756333444',
      description: 'Full advance booking', origin: 'Dar', destination: 'Dodoma',
      total_tzs: 900000, advance_tzs: 900000, amount_paid_tzs: 900000, balance_tzs: 0,
      payment_terms: 'advance', credit_days: 0, invoice_date: '2026-10-12', delivery_date: '2026-10-14',
      due_date: '2026-10-12', status: 'paid', notes: 'Paid in full before loading', created_at: now()
    }
  ]);
}

module.exports = {
  listLoans, createLoan, payLoan, refreshLoanStatuses,
  listInvoices, createInvoice, recordClientPayment, refreshInvoiceStatuses,
  financeSummary, seedFinance
};
