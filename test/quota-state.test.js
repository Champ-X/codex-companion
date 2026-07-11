const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyQuotaState } = require('../src/renderer/quota-state');

test('classifies quota boundaries into five pet states', () => {
  const cases = [
    [100, 'energized'],
    [80, 'energized'],
    [79.9, 'focused'],
    [60, 'focused'],
    [59.9, 'checking'],
    [40, 'checking'],
    [39.9, 'worried'],
    [10.1, 'worried'],
    [10, 'sleepy'],
    [0, 'sleepy'],
  ];

  for (const [remaining, expected] of cases) {
    assert.equal(classifyQuotaState(remaining), expected, `${remaining}%`);
  }
});

test('clamps invalid and out-of-range quota values safely', () => {
  assert.equal(classifyQuotaState(120), 'energized');
  assert.equal(classifyQuotaState(-20), 'sleepy');
  assert.equal(classifyQuotaState(undefined), 'sleepy');
});
