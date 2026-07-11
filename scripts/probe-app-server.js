const { CodexAppServerClient } = require('../src/app-server-client');

async function main() {
  const client = new CodexAppServerClient({ clientVersion: 'probe' });
  try {
    const snapshot = await client.readSnapshot();
    const buckets = snapshot.rateLimits?.rateLimitsByLimitId || {};
    const general = buckets.codex || snapshot.rateLimits?.rateLimits || null;
    console.log(JSON.stringify({
      fetchedAt: snapshot.fetchedAt,
      generalLimit: general && {
        limitId: general.limitId,
        primary: general.primary,
        secondary: general.secondary,
        planType: general.planType,
      },
      tokenUsage: snapshot.tokenUsage,
    }, null, 2));
  } finally {
    client.stop();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
