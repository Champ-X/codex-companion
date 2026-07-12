const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const TOKEN_FIELDS = [
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'total_tokens',
];

function emptyTokenUsage() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

function asNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function rateField(object, snakeCase, camelCase) {
  return object?.[snakeCase] ?? object?.[camelCase];
}

function addTokenUsage(target, source) {
  for (const field of TOKEN_FIELDS) {
    target[field] += asNumber(source?.[field]);
  }
  return target;
}

function tokenDelta(current, previous) {
  const delta = emptyTokenUsage();
  for (const field of TOKEN_FIELDS) {
    const next = asNumber(current?.[field]);
    const before = previous ? asNumber(previous[field]) : 0;
    delta[field] = next >= before ? next - before : next;
  }
  return delta;
}

function parseTimestamp(value, fallback = 0) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parse one Codex rollout JSONL file without retaining prompts or responses.
 * Only token_count events are inspected.
 */
function parseSessionContent(content, { dayStart, dayEnd, fileMtime = 0 }) {
  const daily = emptyTokenUsage();
  let previousTotal = null;
  let rateEvent = null;
  const rateEventsById = new Map();
  let turnCount = 0;

  for (const line of content.split(/\r?\n/)) {
    if (!line || !line.includes('token_count')) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event?.type !== 'event_msg' || event?.payload?.type !== 'token_count') {
      continue;
    }

    const payload = event.payload;
    const eventTime = parseTimestamp(event.timestamp, fileMtime);
    const total = payload.info?.total_token_usage;

    if (total) {
      const delta = tokenDelta(total, previousTotal);
      if (eventTime >= dayStart && eventTime < dayEnd) {
        addTokenUsage(daily, delta);
        if (delta.total_tokens > 0) turnCount += 1;
      }
      previousTotal = total;
    }

    if (payload.rate_limits) {
      const limitId = payload.rate_limits.limit_id || '(no-id)';
      const candidate = {
        timestamp: eventTime,
        fileMtime,
        value: payload.rate_limits,
      };
      const existingForId = rateEventsById.get(limitId);
      if (
        !existingForId ||
        candidate.timestamp > existingForId.timestamp ||
        (candidate.timestamp === existingForId.timestamp &&
          candidate.fileMtime > existingForId.fileMtime)
      ) {
        rateEventsById.set(limitId, candidate);
      }
      if (
        !rateEvent ||
        candidate.timestamp > rateEvent.timestamp ||
        (candidate.timestamp === rateEvent.timestamp && candidate.fileMtime > rateEvent.fileMtime)
      ) {
        rateEvent = candidate;
      }
    }
  }

  return {
    daily,
    rateEvent,
    rateEvents: [...rateEventsById.values()],
    turnCount,
  };
}

function normalizeWindow(window, fallbackMinutes, nowEpochSeconds = Date.now() / 1000) {
  if (!window) return null;
  const observedUsedPercent = Math.max(
    0,
    Math.min(100, asNumber(rateField(window, 'used_percent', 'usedPercent'))),
  );
  const resetsAt = asNumber(rateField(window, 'resets_at', 'resetsAt')) || null;
  const resetEpochSeconds = resetsAt && resetsAt >= 1e12 ? resetsAt / 1000 : resetsAt;
  const hasReset = Boolean(resetEpochSeconds && nowEpochSeconds >= resetEpochSeconds);
  const usedPercent = hasReset ? 0 : observedUsedPercent;
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    observedUsedPercent,
    windowMinutes:
      asNumber(rateField(window, 'window_minutes', 'windowDurationMins')) || fallbackMinutes,
    resetsAt,
    hasReset,
  };
}

function normalizeRateLimits(raw, nowEpochSeconds = Date.now() / 1000) {
  if (!raw) return null;
  const candidates = [raw.primary, raw.secondary, raw.individual_limit].filter(Boolean);
  const byMinutes = (minutes) =>
    candidates.find(
      (item) => asNumber(rateField(item, 'window_minutes', 'windowDurationMins')) === minutes,
    ) || null;

  const fiveHour = normalizeWindow(byMinutes(300) || raw.primary, 300, nowEpochSeconds);
  const weekly = normalizeWindow(byMinutes(10080) || raw.secondary, 10080, nowEpochSeconds);
  const id = rateField(raw, 'limit_id', 'limitId') || null;

  return {
    id,
    name:
      rateField(raw, 'limit_name', 'limitName') ||
      (id === 'codex' ? 'Codex 通用限额' : 'Codex'),
    scope: id === 'codex' ? 'general' : 'other',
    planType: rateField(raw, 'plan_type', 'planType') || null,
    reachedType: rateField(raw, 'rate_limit_reached_type', 'rateLimitReachedType') || null,
    fiveHour,
    weekly,
    credits: raw.credits
      ? {
          hasCredits: Boolean(raw.credits.has_credits),
          unlimited: Boolean(raw.credits.unlimited),
          balance: raw.credits.balance ?? null,
        }
      : null,
  };
}

function isRateLimitSnapshotFresh(previous, candidate, nowEpochSeconds = Date.now() / 1000) {
  if (!previous || !candidate) return true;
  const before = normalizeRateLimits(previous, nowEpochSeconds);
  const next = normalizeRateLimits(candidate, nowEpochSeconds);

  for (const key of ['fiveHour', 'weekly']) {
    const oldWindow = before?.[key];
    const newWindow = next?.[key];
    if (oldWindow && !newWindow) return false;
    if (!oldWindow || !newWindow) continue;

    const oldReset = oldWindow.resetsAt && oldWindow.resetsAt >= 1e12
      ? oldWindow.resetsAt / 1000
      : oldWindow.resetsAt;
    const newReset = newWindow.resetsAt && newWindow.resetsAt >= 1e12
      ? newWindow.resetsAt / 1000
      : newWindow.resetsAt;
    if (oldReset && newReset && newReset < oldReset) return false;

    const sameWindow = oldReset && newReset
      ? newReset === oldReset
      : !oldReset && !newReset;
    if (sameWindow && newWindow.remainingPercent > oldWindow.remainingPercent + 3) {
      return false;
    }
  }

  return true;
}

function isModelSpecificRateLimit(raw) {
  const identity = `${rateField(raw, 'limit_id', 'limitId') || ''} ${rateField(raw, 'limit_name', 'limitName') || ''}`.toLowerCase();
  return /spark|bengalfox/.test(identity);
}

/**
 * Prefer the account-wide Codex bucket. Model-specific buckets (currently
 * identifiable as Spark/bengalfox) must never silently replace it merely
 * because their event is newer.
 */
function selectGeneralRateLimit(events) {
  const usable = events.filter((event) => {
    const raw = event?.value;
    return raw && (raw.primary || raw.secondary);
  });
  const exact = usable
    .filter((event) => rateField(event.value, 'limit_id', 'limitId') === 'codex')
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (exact) return exact;

  return usable
    .filter((event) => !isModelSpecificRateLimit(event.value))
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
}

async function collectJsonlFiles(root) {
  const files = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES') return;
      throw error;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try {
            const stat = await fs.stat(fullPath);
            files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
            // A live session can move while it is being scanned; retry on next refresh.
          }
        }
      }),
    );
  }

  await walk(root);
  return files;
}

function localDayRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime(), key: start.toISOString() };
}

function localDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

class CodexUsageService {
  constructor({
    homeDir = os.homedir(),
    now = () => new Date(),
    liveClient = null,
    liveRateCacheTtlMs = 120_000,
  } = {}) {
    this.codexDir = path.join(homeDir, '.codex');
    this.roots = [
      path.join(this.codexDir, 'sessions'),
      path.join(this.codexDir, 'archived_sessions'),
    ];
    this.now = now;
    this.liveClient = liveClient;
    this.liveRateCacheTtlMs = liveRateCacheTtlMs;
    this.lastLiveGeneralRate = null;
    this.cache = new Map();
  }

  async getUsage({ force = false } = {}) {
    const livePromise = this.liveClient
      ? this.liveClient.readSnapshot().then(
          (snapshot) => ({ snapshot, error: null }),
          (error) => ({ snapshot: null, error }),
        )
      : Promise.resolve({ snapshot: null, error: null });
    const day = localDayRange(this.now());
    const allFiles = (await Promise.all(this.roots.map(collectJsonlFiles))).flat();
    allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Every file touched today is needed for today's token total. A handful of
    // older files are included so the last known weekly window remains visible.
    const candidates = allFiles.filter((file, index) => file.mtimeMs >= day.start || index < 256);
    const daily = emptyTokenUsage();
    const latestRateEventsById = new Map();
    let turnCount = 0;
    let readableFiles = 0;

    for (const file of candidates) {
      const cacheKey = file.path;
      const cached = this.cache.get(cacheKey);
      const cacheValid =
        !force &&
        cached?.size === file.size &&
        cached?.mtimeMs === file.mtimeMs &&
        cached?.dayKey === day.key;

      let parsed = cached?.parsed;
      if (!cacheValid) {
        try {
          const content = await fs.readFile(file.path, 'utf8');
          parsed = parseSessionContent(content, {
            dayStart: day.start,
            dayEnd: day.end,
            fileMtime: file.mtimeMs,
          });
          this.cache.set(cacheKey, {
            size: file.size,
            mtimeMs: file.mtimeMs,
            dayKey: day.key,
            parsed,
          });
        } catch {
          continue;
        }
      }

      readableFiles += 1;
      addTokenUsage(daily, parsed.daily);
      turnCount += parsed.turnCount;
      for (const candidate of parsed.rateEvents || (parsed.rateEvent ? [parsed.rateEvent] : [])) {
        const id = candidate.value?.limit_id || '(no-id)';
        const existing = latestRateEventsById.get(id);
        if (
          !existing ||
          candidate.timestamp > existing.timestamp ||
          (candidate.timestamp === existing.timestamp &&
            candidate.fileMtime > existing.fileMtime)
        ) {
          latestRateEventsById.set(id, candidate);
        }
      }
    }

    const now = this.now();
    const localGeneralRateEvent = selectGeneralRateLimit([...latestRateEventsById.values()]);
    const { snapshot: liveSnapshot, error: liveError } = await livePromise;
    const liveRateResponse = liveSnapshot?.rateLimits;
    const liveRateBuckets = liveRateResponse?.rateLimitsByLimitId || null;
    const liveGeneralRateCandidate =
      liveRateBuckets?.codex ||
      (rateField(liveRateResponse?.rateLimits, 'limit_id', 'limitId') === 'codex'
        ? liveRateResponse.rateLimits
        : null);
    const rejectedStaleLiveRate = Boolean(
      liveGeneralRateCandidate &&
      this.lastLiveGeneralRate &&
      !isRateLimitSnapshotFresh(
        this.lastLiveGeneralRate.value,
        liveGeneralRateCandidate,
        now.getTime() / 1000,
      ),
    );
    const liveGeneralRate = rejectedStaleLiveRate ? null : liveGeneralRateCandidate;
    if (liveGeneralRate) {
      this.lastLiveGeneralRate = {
        value: liveGeneralRate,
        fetchedAtMs: Date.parse(liveSnapshot?.fetchedAt) || now.getTime(),
      };
    }
    const cachedLiveGeneralRate =
      !liveGeneralRate &&
      this.lastLiveGeneralRate &&
      now.getTime() - this.lastLiveGeneralRate.fetchedAtMs <= this.liveRateCacheTtlMs
        ? this.lastLiveGeneralRate
        : null;
    const chosenRate =
      liveGeneralRate || cachedLiveGeneralRate?.value || localGeneralRateEvent?.value || null;
    const rateSource = liveGeneralRate
      ? 'app-server'
      : cachedLiveGeneralRate
        ? 'app-server-cache'
        : 'local-cache';
    const todayAccountBucket = liveSnapshot?.tokenUsage?.dailyUsageBuckets?.find(
      (bucket) => bucket.startDate === localDateKey(now),
    ) || null;
    const uncachedInputTokens = Math.max(
      0,
      daily.input_tokens - daily.cached_input_tokens,
    );
    const effectiveTokens = uncachedInputTokens + daily.output_tokens;
    const displayTokens = todayAccountBucket
      ? asNumber(todayAccountBucket.tokens)
      : daily.total_tokens;
    const isLive = Boolean(liveGeneralRate);
    return {
      ok: readableFiles > 0 || Boolean(chosenRate),
      isLive,
      isStaleRate: Boolean(cachedLiveGeneralRate),
      dataSource: rateSource,
      liveError:
        (rejectedStaleLiveRate ? 'Ignored an older app-server rate-limit snapshot' : null) ||
        liveSnapshot?.rateLimitError ||
        liveError?.message ||
        null,
      updatedAt: now.toISOString(),
      source: this.codexDir,
      filesScanned: readableFiles,
      turnCount,
      today: {
        displayTokens,
        source: todayAccountBucket ? 'account-daily' : 'local-realtime',
        accountTokens: todayAccountBucket ? asNumber(todayAccountBucket.tokens) : null,
        totalTokens: daily.total_tokens,
        processedTokens: daily.total_tokens,
        effectiveTokens,
        inputTokens: daily.input_tokens,
        uncachedInputTokens,
        cachedInputTokens: daily.cached_input_tokens,
        outputTokens: daily.output_tokens,
        reasoningOutputTokens: daily.reasoning_output_tokens,
      },
      limits: normalizeRateLimits(chosenRate, now.getTime() / 1000),
      availableLimitIds: liveRateBuckets
        ? Object.keys(liveRateBuckets)
        : [...latestRateEventsById.keys()],
      limitObservedAt: liveGeneralRate
        ? liveSnapshot.fetchedAt
        : cachedLiveGeneralRate
          ? new Date(cachedLiveGeneralRate.fetchedAtMs).toISOString()
        : localGeneralRateEvent
          ? new Date(localGeneralRateEvent.timestamp).toISOString()
          : null,
      message:
        readableFiles > 0
          ? null
          : `未在 ${this.codexDir} 中找到可读取的 Codex 会话`,
    };
  }
}

module.exports = {
  CodexUsageService,
  emptyTokenUsage,
  localDayRange,
  localDateKey,
  normalizeRateLimits,
  isRateLimitSnapshotFresh,
  parseSessionContent,
  selectGeneralRateLimit,
  tokenDelta,
};
