const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../server/db');
const modules = require('../server/modules');
const finance = require('../server/finance');
const team = require('../server/team');

const companyA = 'test-company-a';
const companyB = 'test-company-b';
const ownerA = { id: 'owner-a', role: 'fleet_manager', company_id: companyA };
const ownerB = { id: 'owner-b', role: 'fleet_manager', company_id: companyB };

test('trip lists and updates are isolated by company', () => {
  db.write('trips', [
    { id: 'trip-a', company_id: companyA, destination: 'A' },
    { id: 'trip-b', company_id: companyB, destination: 'B' }
  ]);
  assert.deepEqual(modules.listTrips(ownerA).map(x => x.id), ['trip-a']);
  assert.equal(modules.updateTrip(ownerA, 'trip-b', { destination: 'Changed' }), null);
  assert.equal(db.read('trips').find(x => x.id === 'trip-b').destination, 'B');
});

test('trip creation rejects a vehicle or driver owned by another company', () => {
  db.write('vehicles', [{ id: 'vehicle-b', company_id: companyB }]);
  db.write('drivers', [{ id: 'driver-b', company_id: companyB }]);
  assert.throws(() => modules.createTrip(ownerA, { vehicle_id: 'vehicle-b' }), /does not belong/);
  assert.throws(() => modules.createTrip(ownerA, { driver_id: 'driver-b' }), /does not belong/);
});

test('finance records cannot be paid or changed across company boundaries', () => {
  db.write('supplier_loans', [{ id: 'loan-b', company_id: companyB, amount_tzs: 1000, amount_paid_tzs: 0, balance_tzs: 1000 }]);
  db.write('client_invoices', [{ id: 'invoice-b', company_id: companyB, total_tzs: 1000, amount_paid_tzs: 0, balance_tzs: 1000 }]);
  assert.equal(finance.payLoan(ownerA, 'loan-b', 100), null);
  assert.equal(finance.recordClientPayment(ownerA, 'invoice-b', 100), null);
  assert.equal(db.read('supplier_loans')[0].amount_paid_tzs, 0);
  assert.equal(db.read('client_invoices')[0].amount_paid_tzs, 0);
});

test('finance rejects negative, zero and over-balance payments', () => {
  db.write('supplier_loans', [{ id: 'loan-a', company_id: companyA, amount_tzs: 1000, amount_paid_tzs: 200, balance_tzs: 800, due_date: '2099-01-01' }]);
  db.write('client_invoices', [{ id: 'invoice-a', company_id: companyA, total_tzs: 1000, amount_paid_tzs: 200, balance_tzs: 800, due_date: '2099-01-01' }]);
  for (const amount of [0, -1, 801]) {
    assert.throws(() => finance.payLoan(ownerA, 'loan-a', amount));
    assert.throws(() => finance.recordClientPayment(ownerA, 'invoice-a', amount));
  }
  assert.equal(finance.payLoan(ownerA, 'loan-a', 800).status, 'paid');
  assert.equal(finance.recordClientPayment(ownerA, 'invoice-a', 800).status, 'paid');
});

test('only the company owner can appoint a Company Admin', () => {
  db.write('users', []);
  assert.throws(() => team.createCompanyUser({ id: 'admin-a', role: 'company_admin', company_id: companyA }, {
    email: 'new-admin@example.test', password: 'strong-password-123', role: 'company_admin'
  }), /Only the company owner/);
});

test('auditor and viewer presets do not grant team administration', () => {
  assert.equal(team.ROLE_PRESETS.auditor.permissions.team, false);
  assert.equal(team.ROLE_PRESETS.viewer.permissions.team, false);
});
