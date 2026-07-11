(function exposeQuotaState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CodexQuotaState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const QUOTA_TIERS = Object.freeze([
    Object.freeze({ state: 'energized', min: 80, max: 100 }),
    Object.freeze({ state: 'focused', min: 60, max: 80 }),
    Object.freeze({ state: 'checking', min: 40, max: 60 }),
    Object.freeze({ state: 'worried', min: 10, max: 40 }),
    Object.freeze({ state: 'sleepy', min: 0, max: 10 }),
  ]);

  function classifyQuotaState(value) {
    const remaining = Math.max(0, Math.min(100, Number(value) || 0));
    if (remaining >= 80) return 'energized';
    if (remaining >= 60) return 'focused';
    if (remaining >= 40) return 'checking';
    if (remaining > 10) return 'worried';
    return 'sleepy';
  }

  function selectPetRemaining(limits) {
    const fiveHour = Number(limits?.fiveHour?.remainingPercent);
    if (Number.isFinite(fiveHour)) return fiveHour;

    const weekly = Number(limits?.weekly?.remainingPercent);
    return Number.isFinite(weekly) ? weekly : 100;
  }

  return { QUOTA_TIERS, classifyQuotaState, selectPetRemaining };
}));
