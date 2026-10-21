/**
 * Operating expenses: rent, yard, security, salaries, utilities, etc.
 */
const { read, write, uid, now } = require('./db');

function companyFilter(list, auth) {
  if (!list) return [];
  if (auth.role === 'platform_admin') return list;
  return list.filter(x => x.company_id === auth.company_id);
}

const CATEGORIES = [
  'office_rent', 'yard_rent', 'security', 'salaries', 'utilities',
  'insurance', 'parking', 'admin', 'other'
];

function listExpenses(auth) {
  return companyFilter(read('expenses') || [], auth).sort((a, b) =>
    (b.expense_date || '').localeCompare(a.expense_date || '')
  );
}

function createExpense(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  const exp = {
    id: uid(),
    company_id: auth.company_id,
    category: CATEGORIES.includes(body.category) ? body.category : 'other',
    description: body.description || '',
    amount_tzs: Number(body.amount_tzs) || 0,
    expense_date: body.expense_date || new Date().toISOString().slice(0, 10),
    vendor: body.vendor || '',
    notes: body.notes || '',
    created_by: auth.id,
    created_at: now()
  };
  const all = read('expenses') || [];
  all.push(exp);
  write('expenses', all);
  return exp;
}

function deleteExpense(auth, id) {
  let all = read('expenses') || [];
  const before = all.length;
  all = all.filter(e => !(e.id === id && (auth.role === 'platform_admin' || e.company_id === auth.company_id)));
  write('expenses', all);
  return all.length < before;
}

function totalExpenses(auth) {
  return listExpenses(auth).reduce((s, e) => s + (e.amount_tzs || 0), 0);
}

module.exports = { listExpenses, createExpense, deleteExpense, totalExpenses, CATEGORIES };
