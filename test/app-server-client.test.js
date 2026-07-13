const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { CodexAppServerClient, findCodexExecutable } = require('../src/app-server-client');

function fakeFs(existing = [], mtimes = {}) {
  const files = new Set(existing);
  return {
    existsSync: (candidate) => files.has(candidate),
    readdirSync: () => Object.keys(mtimes).map((name) => ({
      name,
      isDirectory: () => true,
    })),
    statSync: (candidate) => ({
      mtimeMs: mtimes[path.basename(path.dirname(candidate))] || 0,
    }),
  };
}

test('findCodexExecutable honors an explicit override on every platform', () => {
  assert.equal(
    findCodexExecutable({
      platform: 'darwin',
      env: { CODEX_EXECUTABLE: '/custom/codex' },
      homeDir: '/Users/test',
      fsApi: fakeFs(),
    }),
    '/custom/codex',
  );
});

test('findCodexExecutable prefers the standalone macOS installation', () => {
  const homeDir = '/Users/test';
  const localBin = path.join(homeDir, '.local', 'bin', 'codex');
  const standalone = path.join(
    homeDir,
    '.codex',
    'packages',
    'standalone',
    'current',
    'bin',
    'codex',
  );

  assert.equal(
    findCodexExecutable({
      platform: 'darwin',
      env: {},
      homeDir,
      fsApi: fakeFs([localBin, standalone, '/opt/homebrew/bin/codex']),
    }),
    localBin,
  );
});

test('findCodexExecutable checks Homebrew and bundled macOS applications', () => {
  const homeDir = '/Users/test';
  const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex';

  assert.equal(
    findCodexExecutable({
      platform: 'darwin',
      env: {},
      homeDir,
      fsApi: fakeFs(['/opt/homebrew/bin/codex', bundled]),
    }),
    '/opt/homebrew/bin/codex',
  );
  assert.equal(
    findCodexExecutable({
      platform: 'darwin',
      env: {},
      homeDir,
      fsApi: fakeFs([bundled]),
    }),
    bundled,
  );
});

test('findCodexExecutable falls back to PATH resolution on macOS', () => {
  assert.equal(
    findCodexExecutable({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/test',
      fsApi: fakeFs(),
    }),
    'codex',
  );
});

test('findCodexExecutable keeps the newest Windows desktop runtime', () => {
  const localAppData = 'C:\\Users\\test\\AppData\\Local';
  const runtimeRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
  const older = path.join(runtimeRoot, 'runtime-1', 'codex.exe');
  const newer = path.join(runtimeRoot, 'runtime-2', 'codex.exe');

  assert.equal(
    findCodexExecutable({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData },
      homeDir: 'C:\\Users\\test',
      fsApi: fakeFs([older, newer], { 'runtime-1': 100, 'runtime-2': 200 }),
    }),
    newer,
  );
});

test('CodexAppServerClient reports a helpful missing executable error', async () => {
  const client = new CodexAppServerClient({ executable: '/missing/codex' });
  await assert.rejects(
    client.start(),
    /未找到 Codex 可执行文件.*请先安装并登录 Codex/,
  );
});
