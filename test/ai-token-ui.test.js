const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Fleet AI Integration page provides an owner token generation control', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(app, /id="generate-mlimani-ai-token"/);
  assert.match(app, /function generateMlimaniAIToken\(\)/);
  assert.match(app, /api\('\/api\/integrations\/access-token'/);
  assert.match(app, /function copyMlimaniAIToken\(\)/);
  assert.match(app, /function hideMlimaniAIToken\(\)/);
});
