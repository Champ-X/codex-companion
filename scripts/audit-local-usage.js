const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { parseSessionContent, localDayRange } = require('../src/usage-service');

const roots = [
  path.join(os.homedir(), '.codex', 'sessions'),
  path.join(os.homedir(), '.codex', 'archived_sessions'),
];

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
  }
  return files;
}

async function main() {
  const limits = new Map();
  const files = roots.flatMap((root) => walk(root));
  const names = new Map();

  for (const file of files) {
    const basename = path.basename(file);
    names.set(basename, (names.get(basename) || 0) + 1);
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"rate_limits"')) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const rate = event?.payload?.rate_limits;
      if (event?.payload?.type !== 'token_count' || !rate) continue;
      const id = rate.limit_id || '(no-id)';
      const timestamp = Date.parse(event.timestamp) || 0;
      const prior = limits.get(id);
      const summary = {
        id,
        name: rate.limit_name || null,
        count: (prior?.count || 0) + 1,
        latestAt: prior?.latestAt || 0,
        primary: prior?.primary || null,
        secondary: prior?.secondary || null,
        planType: rate.plan_type || prior?.planType || null,
      };
      if (timestamp >= summary.latestAt) {
        summary.latestAt = timestamp;
        summary.primary = rate.primary || null;
        summary.secondary = rate.secondary || null;
      }
      limits.set(id, summary);
    }
  }

  const output = [...limits.values()]
    .sort((a, b) => b.latestAt - a.latestAt)
    .map((item) => ({ ...item, latestAt: new Date(item.latestAt).toISOString() }));
  const day = localDayRange(new Date());
  const dailyByFile = files.map((file) => {
    const stat = fs.statSync(file);
    if (stat.mtimeMs < day.start) return null;
    const parsed = parseSessionContent(fs.readFileSync(file, 'utf8'), {
      dayStart: day.start,
      dayEnd: day.end,
      fileMtime: stat.mtimeMs,
    });
    return {
      file: path.basename(file),
      totalTokens: parsed.daily.total_tokens,
      uncachedInputTokens: Math.max(
        0,
        parsed.daily.input_tokens - parsed.daily.cached_input_tokens,
      ),
      cachedInputTokens: parsed.daily.cached_input_tokens,
      outputTokens: parsed.daily.output_tokens,
    };
  }).filter((item) => item?.totalTokens > 0);
  const dailyTotals = dailyByFile.reduce((sum, item) => ({
    totalTokens: sum.totalTokens + item.totalTokens,
    uncachedInputTokens: sum.uncachedInputTokens + item.uncachedInputTokens,
    cachedInputTokens: sum.cachedInputTokens + item.cachedInputTokens,
    outputTokens: sum.outputTokens + item.outputTokens,
  }), { totalTokens: 0, uncachedInputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });

  console.log(JSON.stringify({
    fileCount: files.length,
    duplicateBasenames: [...names.entries()].filter(([, count]) => count > 1),
    limits: output,
    dailyTotals,
    dailyTopFiles: dailyByFile
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
