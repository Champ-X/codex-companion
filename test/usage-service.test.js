const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CodexUsageService,
  isRateLimitSnapshotFresh,
  normalizeRateLimits,
  parseSessionContent,
  selectGeneralRateLimit,
  tokenDelta,
} = require('../src/usage-service');

function event(timestamp, total, rateLimits = null) {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: total
        ? {
            total_token_usage: total,
            last_token_usage: total,
          }
        : null,
      rate_limits: rateLimits,
    },
  });
}

test('tokenDelta handles cumulative totals and counter resets', () => {
  assert.deepEqual(
    tokenDelta(
      { input_tokens: 120, output_tokens: 20, total_tokens: 140 },
      { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    ),
    {
      input_tokens: 20,
      cached_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: 30,
    },
  );

  assert.equal(
    tokenDelta({ total_tokens: 25 }, { total_tokens: 300 }).total_tokens,
    25,
  );
});

test('parseSessionContent sums only increments observed during the local day', () => {
  const dayStart = Date.parse('2026-07-10T00:00:00.000Z');
  const dayEnd = Date.parse('2026-07-11T00:00:00.000Z');
  const content = [
    event('2026-07-09T23:58:00.000Z', { input_tokens: 90, output_tokens: 10, total_tokens: 100 }),
    event('2026-07-10T00:02:00.000Z', { input_tokens: 140, output_tokens: 20, total_tokens: 160 }),
    event('2026-07-10T02:00:00.000Z', { input_tokens: 230, output_tokens: 30, total_tokens: 260 }),
    event('2026-07-11T01:00:00.000Z', { input_tokens: 300, output_tokens: 40, total_tokens: 340 }),
  ].join('\n');

  const parsed = parseSessionContent(content, { dayStart, dayEnd });
  assert.equal(parsed.daily.input_tokens, 140);
  assert.equal(parsed.daily.output_tokens, 20);
  assert.equal(parsed.daily.total_tokens, 160);
  assert.equal(parsed.turnCount, 2);
});

test('normalizeRateLimits identifies five-hour and weekly windows by duration', () => {
  const normalized = normalizeRateLimits(
    {
      limit_id: 'codex-example',
      limit_name: 'Codex',
      primary: { used_percent: 17, window_minutes: 10080, resets_at: 200 },
      secondary: { used_percent: 61, window_minutes: 300, resets_at: 100 },
    },
    0,
  );

  assert.equal(normalized.fiveHour.usedPercent, 61);
  assert.equal(normalized.fiveHour.resetsAt, 100);
  assert.equal(normalized.weekly.usedPercent, 17);
  assert.equal(normalized.weekly.resetsAt, 200);
});

test('parseSessionContent keeps the newest rate-limit event', () => {
  const oldLimits = { primary: { used_percent: 10, window_minutes: 300 } };
  const newLimits = { primary: { used_percent: 20, window_minutes: 300 } };
  const parsed = parseSessionContent(
    [
      event('2026-07-10T01:00:00.000Z', null, oldLimits),
      event('2026-07-10T02:00:00.000Z', null, newLimits),
    ].join('\n'),
    { dayStart: 0, dayEnd: Number.MAX_SAFE_INTEGER },
  );

  assert.equal(parsed.rateEvent.value.primary.used_percent, 20);
  assert.equal(parsed.rateEvents.length, 1);
});

test('selectGeneralRateLimit prefers codex over a newer Spark bucket', () => {
  const selected = selectGeneralRateLimit([
    {
      timestamp: 200,
      value: {
        limit_id: 'codex_bengalfox',
        limit_name: 'GPT-5.3-Codex-Spark',
        primary: { used_percent: 10, window_minutes: 300 },
      },
    },
    {
      timestamp: 100,
      value: {
        limit_id: 'codex',
        primary: { used_percent: 40, window_minutes: 300 },
      },
    },
  ]);

  assert.equal(selected.value.limit_id, 'codex');
});

test('normalizeRateLimits reports an expired window as fully remaining', () => {
  const normalized = normalizeRateLimits(
    {
      limit_id: 'codex',
      primary: { used_percent: 36, window_minutes: 300, resets_at: 100 },
      secondary: { used_percent: 55, window_minutes: 10080, resets_at: 300 },
    },
    200,
  );

  assert.equal(normalized.name, 'Codex 通用限额');
  assert.equal(normalized.fiveHour.usedPercent, 0);
  assert.equal(normalized.fiveHour.remainingPercent, 100);
  assert.equal(normalized.fiveHour.hasReset, true);
  assert.equal(normalized.weekly.remainingPercent, 45);
});

test('isRateLimitSnapshotFresh rejects older windows and impossible upward jumps', () => {
  const current = {
    limit_id: 'codex',
    primary: { used_percent: 52, window_minutes: 300, resets_at: 2_000 },
    secondary: { used_percent: 41, window_minutes: 10080, resets_at: 5_000 },
  };
  const older = {
    limit_id: 'codex',
    primary: { used_percent: 0, window_minutes: 300, resets_at: 1_000 },
    secondary: { used_percent: 22, window_minutes: 10080, resets_at: 4_000 },
  };
  const sameWindowJump = {
    limit_id: 'codex',
    primary: { used_percent: 0, window_minutes: 300, resets_at: 2_000 },
    secondary: { used_percent: 22, window_minutes: 10080, resets_at: 5_000 },
  };
  const legitimateReset = {
    limit_id: 'codex',
    primary: { used_percent: 0, window_minutes: 300, resets_at: 3_000 },
    secondary: { used_percent: 42, window_minutes: 10080, resets_at: 5_000 },
  };

  assert.equal(isRateLimitSnapshotFresh(current, older, 100), false);
  assert.equal(isRateLimitSnapshotFresh(current, sameWindowJump, 100), false);
  assert.equal(isRateLimitSnapshotFresh(current, legitimateReset, 100), true);
});

test('CodexUsageService prefers live app-server limits and account daily tokens', async () => {
  const now = new Date('2026-07-11T01:00:00.000Z');
  const service = new CodexUsageService({
    homeDir: 'Z:\\codex-companion-test-missing-home',
    now: () => now,
    liveClient: {
      readSnapshot: async () => ({
        fetchedAt: now.toISOString(),
        rateLimits: {
          rateLimits: null,
          rateLimitsByLimitId: {
            codex: {
              limitId: 'codex',
              primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 9999999999 },
              secondary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 9999999999 },
            },
          },
        },
        tokenUsage: {
          dailyUsageBuckets: [{ startDate: '2026-07-11', tokens: 123456 }],
          summary: {},
        },
      }),
    },
  });

  const usage = await service.getUsage();
  assert.equal(usage.isLive, true);
  assert.equal(usage.dataSource, 'app-server');
  assert.equal(usage.limits.fiveHour.remainingPercent, 88);
  assert.equal(usage.limits.weekly.remainingPercent, 98);
  assert.equal(usage.today.displayTokens, 123456);
  assert.equal(usage.today.source, 'account-daily');
});

test('CodexUsageService keeps the last trusted live limits during a transient rate-limit failure', async () => {
  const now = new Date('2026-07-13T01:00:00.000Z');
  let call = 0;
  const service = new CodexUsageService({
    homeDir: 'Z:\\codex-companion-test-missing-home',
    now: () => now,
    liveClient: {
      readSnapshot: async () => {
        call += 1;
        if (call === 1) {
          return {
            fetchedAt: now.toISOString(),
            rateLimits: {
              rateLimitsByLimitId: {
                codex: {
                  limitId: 'codex',
                  primary: {
                    usedPercent: 52,
                    windowDurationMins: 300,
                    resetsAt: 9999999999,
                  },
                  secondary: {
                    usedPercent: 41,
                    windowDurationMins: 10080,
                    resetsAt: 9999999999,
                  },
                },
              },
            },
            tokenUsage: null,
          };
        }
        return {
          fetchedAt: now.toISOString(),
          rateLimits: null,
          rateLimitError: 'account/rateLimits/read request timed out',
          tokenUsage: { dailyUsageBuckets: [] },
        };
      },
    },
  });

  const live = await service.getUsage();
  const transientFailure = await service.getUsage();

  assert.equal(live.limits.fiveHour.remainingPercent, 48);
  assert.equal(live.limits.weekly.remainingPercent, 59);
  assert.equal(transientFailure.dataSource, 'app-server-cache');
  assert.equal(transientFailure.isStaleRate, true);
  assert.equal(transientFailure.limits.fiveHour.remainingPercent, 48);
  assert.equal(transientFailure.limits.weekly.remainingPercent, 59);
  assert.match(transientFailure.liveError, /timed out/);
});
