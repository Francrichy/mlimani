const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-only-secret-with-more-than-thirty-two-characters';
const integration = require('../server/integrations');

test('MCP tool catalogue exposes tenant-scoped read tools and approval-only writes', () => {
  const names = integration.TOOL_DEFINITIONS.map(tool => tool.name);
  assert.ok(names.includes('mlimani_list_vehicles'));
  assert.ok(names.includes('mlimani_finance_summary'));
  assert.ok(names.includes('mlimani_request_write_approval'));
  assert.equal(names.some(name => /delete|remove|pay|transfer/i.test(name)), false);
});

test('write proposals are the only write tool exposed to MCP', () => {
  const writes = integration.TOOL_DEFINITIONS.filter(tool => tool.permission === 'write');
  assert.deepEqual(writes.map(tool => tool.name), ['mlimani_request_write_approval']);
});
