const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

function findCodexExecutable({ platform = process.platform, env = process.env } = {}) {
  if (env.CODEX_EXECUTABLE) return env.CODEX_EXECUTABLE;
  if (platform !== 'win32') return 'codex';

  const runtimeRoot = path.join(env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try {
    const candidates = fs.readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runtimeRoot, entry.name, 'codex.exe'))
      .filter((candidate) => fs.existsSync(candidate))
      .map((candidate) => ({ candidate, mtimeMs: fs.statSync(candidate).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (candidates.length) return candidates[0].candidate;
  } catch {
    // Fall through to PATH resolution for CLI-only installations.
  }
  return 'codex.exe';
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
        if (!this.initialized) reject(error);
        this.#rejectAll(error);
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
      tokenUsage: usageResult.status === 'fulfilled' ? usageResult.value : null,
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
