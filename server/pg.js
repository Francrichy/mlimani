/** @deprecated use db.initDb — kept for index.js compatibility */
const { initDb } = require('./db');
async function initPg() {
  return initDb();
}
module.exports = { initPg };
