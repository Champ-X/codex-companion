const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findCodexExecutable(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const fsApi = options.fsApi || fs;
  const homeDir = options.homeDir || env.HOME || env.USERPROFILE || os.homedir();

  if (env.CODEX_EXECUTABLE) return env.CODEX_EXECUTABLE;

  if (platform === 'win32') {
    const runtimeRoot = path.join(env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = fsApi.readdirSync(runtimeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(runtimeRoot, entry.name, 'codex.exe'))
        .filter((candidate) => fsApi.existsSync(candidate))
        .map((candidate) => ({ candidate, mtimeMs: fsApi.statSync(candidate).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (candidates.length) return candidates[0].candidate;
    } catch {
      // Fall through to PATH resolution for CLI-only installations.
    }
    return 'codex.exe';
  }

  if (platform === 'darwin') {
    const candidates = [
      path.join(homeDir, '.local', 'bin', 'codex'),
      path.join(homeDir, '.codex', 'packages', 'standalone', 'current', 'bin', 'codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      path.join(homeDir, '.npm-global', 'bin', 'codex'),
      path.join(homeDir, '.volta', 'bin', 'codex'),
      path.join(homeDir, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      path.join(homeDir, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
      '/Applications/Codex.app/Contents/Resources/codex',
    ];
    const installed = candidates.find((candidate) => {
      try {
        return fsApi.existsSync(candidate);
      } catch {
        return false;
      }
    });
    if (installed) return installed;
  }

  return 'codex';
}

function spawnError(error, executable) {
  if (error?.code !== 'ENOENT') return error;
  const wrapped = new Error(
    `未找到 Codex 可执行文件（${executable}）。请先安装并登录 Codex，或通过 CODEX_EXECUTABLE 指定可执行文件路径。`,
  );
  wrapped.code = error.code;
  wrapped.cause = error;
  return wrapped;
}

class CodexAppServerClient {
  constructor({ executable, timeoutMs = 10_000, clientVersion = '1.2.0' } = {}) {
    this.executable = executable || findCodexExecutable();
    this.timeoutMs = timeoutMs;
    this.clientVersion = clientVersion;
    this.process = null;
    this.startPromise = null;
    this.initialized = false;
    this.nextId = 1;
    this.pending = new Map();
  }

  async start() {
    if (this.process && this.initialized) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['app-server'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.process = child;

      const failStart = (error) => {
        const failure = spawnError(error, this.executable);
        if (!this.initialized) reject(failure);
        this.#rejectAll(failure);
        this.#clearProcess();
      };

      child.once('error', failStart);
      child.once('exit', (code) => {
        failStart(new Error(`Codex app-server 已退出（代码 ${code ?? 'unknown'}）`));
      });
      child.stderr.resume();

      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', (line) => this.#handleLine(line));

      this.#requestWithId(0, 'initialize', {
        clientInfo: {
          name: 'codex_pet',
          title: 'Codex Companion',
          version: this.clientVersion,
        },
        capabilities: {
          optOutNotificationMethods: [
            'thread/started',
            'item/started',
            'item/completed',
          ],
        },
      }).then(() => {
        this.#write({ method: 'initialized' });
        this.initialized = true;
        resolve();
      }, failStart);
    }).finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async readSnapshot() {
    await this.start();
    const [rateResult, usageResult] = await Promise.allSettled([
      this.request('account/rateLimits/read'),
      this.request('account/usage/read'),
    ]);
    if (rateResult.status === 'rejected' && usageResult.status === 'rejected') {
      throw rateResult.reason;
    }
    return {
      rateLimits: rateResult.status === 'fulfilled' ? rateResult.value : null,
      rateLimitError:
        rateResult.status === 'rejected'
          ? rateResult.reason?.message || 'account/rateLimits/read failed'
          : null,
      tokenUsage: usageResult.status === 'fulfilled' ? usageResult.value : null,
      usageError:
        usageResult.status === 'rejected'
          ? usageResult.reason?.message || 'account/usage/read failed'
          : null,
      fetchedAt: new Date().toISOString(),
    };
  }

  async request(method, params) {
    await this.start();
    const id = this.nextId++;
    return this.#requestWithId(id, method, params);
  }

  stop() {
    if (!this.process) return;
    this.process.removeAllListeners('exit');
    this.process.removeAllListeners('error');
    this.process.kill();
    this.#rejectAll(new Error('Codex app-server 已停止'));
    this.#clearProcess();
  }

  #requestWithId(id, method, params) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const message = { method, id };
      if (params !== undefined) message.params = params;
      try {
        this.#write(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  #write(message) {
    if (!this.process?.stdin?.writable) {
      throw new Error('Codex app-server 尚未就绪');
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || 'Codex app-server 请求失败'));
    } else {
      pending.resolve(message.result);
    }
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  #clearProcess() {
    this.process = null;
    this.initialized = false;
  }
}

module.exports = { CodexAppServerClient, findCodexExecutable };
