/**
 * Optional PostgreSQL layer.
 * Set DATABASE_URL=postgres://user:pass@host:5432/mlimanifleet
 * Falls back to JSON file store when pg is unavailable or URL missing.
 */
const { read, write, uid, now } = require('./db');

let pool = null;
let usePg = false;

async function initPg() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('DB: JSON file store (set DATABASE_URL for PostgreSQL)');
    return false;
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false });
    await pool.query('SELECT 1');
    await migrate();
    usePg = true;
    console.log('DB: PostgreSQL connected');
    return true;
  } catch (e) {
    console.warn('DB: PostgreSQL unavailable, using JSON —', e.message);
    usePg = false;
    return false;
  }
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY, name TEXT, phone TEXT, email TEXT,
      subscription_status TEXT, vehicle_limit INT, current_vehicles INT,
      next_billing_date TEXT, trial_ends TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT, name TEXT,
      role TEXT, company_id TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY, company_id TEXT, plate TEXT, type TEXT,
      make TEXT, model TEXT, year INT, status TEXT, odometer INT,
      driver_id TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY, company_id TEXT, name TEXT, phone TEXT,
      license_no TEXT, license_expiry TEXT, status TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY, company_id TEXT, vehicle_id TEXT, driver_id TEXT,
      type TEXT, origin TEXT, destination TEXT, status TEXT,
      started_at TEXT, ended_at TEXT, distance_km REAL, revenue_tzs REAL,
      notes TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS maintenance (
      id TEXT PRIMARY KEY, company_id TEXT, vehicle_id TEXT, type TEXT,
      description TEXT, status TEXT, priority TEXT, due_date TEXT,
      due_odometer INT, cost_tzs REAL, completed_at TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS fuel_logs (
      id TEXT PRIMARY KEY, company_id TEXT, vehicle_id TEXT, liters REAL,
      cost_tzs REAL, odometer INT, station TEXT, filled_at TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, company_id TEXT, amount REAL, currency TEXT,
      phone TEXT, gateway TEXT, provider TEXT, status TEXT, tier_id TEXT,
      vehicle_count INT, gateway_ref TEXT, completed_at TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pricing_tiers (
      id TEXT PRIMARY KEY, name TEXT, min_vehicles INT, max_vehicles INT,
      price_tzs INT, sort INT, active BOOLEAN, per_vehicle INT
    );
  `);
}

/** Generic helpers — when usePg, map simple table ops; else JSON */
function tableRead(name) {
  if (!usePg) return read(name);
  // For simplicity in zero-dep preferred path, still use JSON unless pg fully wired for every route.
  // Production: replace route handlers to use pool.query.
  return read(name);
}

function tableWrite(name, data) {
  if (!usePg) return write(name, data);
  return write(name, data);
}

module.exports = { initPg, get pool() { return pool; }, get usePg() { return usePg; }, tableRead, tableWrite, migrate };
