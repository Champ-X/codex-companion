const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyQuotaState, selectPetRemaining } = require('../src/renderer/quota-state');

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

test('drives the pet from 5h quota instead of the lower weekly quota', () => {
  const limits = {
    fiveHour: { remainingPercent: 89 },
    weekly: { remainingPercent: 72 },
  };

  const remaining = selectPetRemaining(limits);
  assert.equal(remaining, 89);
  assert.equal(classifyQuotaState(remaining), 'energized');
});

test('falls back to weekly quota only when 5h data is unavailable', () => {
  assert.equal(selectPetRemaining({ weekly: { remainingPercent: 64 } }), 64);
  assert.equal(selectPetRemaining({}), 100);
});
