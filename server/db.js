/**
 * MlimaniFleet data layer
 * - Default: JSON files in /data (demo / local)
 * - Production: set DATABASE_URL → PostgreSQL JSONB store (survives redeploys)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const memory = new Map(); // name -> array/object
let pool = null;
let usePg = false;
let ready = false;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function now() {
  return new Date().toISOString();
}

function readFile(name) {
  ensureDir();
  const p = filePath(name);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function writeFile(name, data) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
}

function read(name) {
  if (memory.has(name)) {
    const v = memory.get(name);
    return Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? { ...v } : v);
  }
  const data = readFile(name);
  memory.set(name, data);
  return Array.isArray(data) ? data.slice() : data;
}

function write(name, data) {
  memory.set(name, data);
  if (usePg && pool) {
    // Fire-and-forget persist (awaited on critical paths via flush)
    pool.query(
      `INSERT INTO app_kv (name, data, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (name) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
      [name, JSON.stringify(data)]
    ).catch(err => console.error('PG write failed', name, err.message));
  } else {
    writeFile(name, data);
  }
}

/** Force write to complete (use before shutdown if needed) */
async function flush(name) {
  if (!usePg || !pool) return;
  const data = memory.has(name) ? memory.get(name) : readFile(name);
  await pool.query(
    `INSERT INTO app_kv (name, data, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (name) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
    [name, JSON.stringify(data)]
  );
}

async function flushAll() {
  if (!usePg || !pool) return;
  for (const name of memory.keys()) {
    await flush(name);
  }
}

/**
 * Call once at startup. With DATABASE_URL loads all keys from Postgres.
 */
async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('DB: JSON files in data/ (set DATABASE_URL for permanent storage)');
    ready = true;
    return { mode: 'json' };
  }
  try {
    const { Pool } = require('pg');
    const ssl =
      process.env.PGSSL === 'false'
        ? false
        : url.includes('localhost')
          ? false
          : { rejectUnauthorized: false };
    pool = new Pool({ connectionString: url, ssl, max: 5 });
    await pool.query('SELECT 1');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_kv (
        name TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    const { rows } = await pool.query('SELECT name, data FROM app_kv');
    for (const row of rows) {
      memory.set(row.name, row.data);
    }
    // One-time migrate: if PG empty but local JSON has data, import
    if (rows.length === 0) {
      ensureDir();
      const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')) : [];
      for (const f of files) {
        const name = f.replace(/\.json$/, '');
        const data = readFile(name);
        memory.set(name, data);
        await pool.query(
          `INSERT INTO app_kv (name, data) VALUES ($1, $2::jsonb) ON CONFLICT (name) DO NOTHING`,
          [name, JSON.stringify(data)]
        );
      }
      if (files.length) console.log('DB: imported', files.length, 'JSON files into PostgreSQL');
    }
    usePg = true;
    ready = true;
    console.log('DB: PostgreSQL ready (', rows.length || 'migrated', 'collections)');
    return { mode: 'postgres', collections: rows.length };
  } catch (e) {
    console.warn('DB: PostgreSQL failed, using JSON files —', e.message);
    usePg = false;
    pool = null;
    ready = true;
    return { mode: 'json', error: e.message };
  }
}

module.exports = {
  read,
  write,
  uid,
  now,
  DATA_DIR,
  initDb,
  flush,
  flushAll,
  get usePg() {
    return usePg;
  },
  get ready() {
    return ready;
  }
};
