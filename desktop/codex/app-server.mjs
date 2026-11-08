import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { access, readdir, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

async function executable(path) { try { await access(path); return true; } catch { return false; } }

export async function findCodexExecutable({ env = process.env, platform = process.platform } = {}) {
  if (env.CODEX_POCKET_CODEX) {
    if (!await executable(env.CODEX_POCKET_CODEX)) throw new Error(`CODEX_POCKET_CODEX does not exist: ${env.CODEX_POCKET_CODEX}`);
    return env.CODEX_POCKET_CODEX;
  }
  const path = env.Path || env.PATH || '';
  const name = platform === 'win32' ? 'codex.exe' : 'codex';
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    if (await executable(candidate)) return candidate;
  }
  if (platform === 'win32' && env.LOCALAPPDATA) {
    const bin = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const candidates = [];
    for (const entry of await readdir(bin, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const candidate = join(bin, entry.name, 'codex.exe');
      try { candidates.push({ candidate, modified: (await stat(candidate)).mtimeMs }); } catch { /* another version */ }
    }
    candidates.sort((a, b) => b.modified - a.modified);
    if (candidates.length) return candidates[0].candidate;
  }
  throw new Error('Cannot find Codex CLI. Set CODEX_POCKET_CODEX to the full path of codex.exe.');
}

/** One private, local stdio connection to Codex. The browser never sees this transport. */
export class CodexAppServer extends EventEmitter {
  constructor({ command, args = ['app-server'], cwd = process.cwd() } = {}) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.sequence = 0;
    this.pending = new Map();
    this.requests = new Map();
    this.child = null;
  }

  async start() {
    if (this.child) return;
    const command = this.command || await findCodexExecutable();
    const child = spawn(command, this.args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    child.stderr.on('data', data => this.emit('log', String(data).trim()));
    createInterface({ input: child.stdout }).on('line', line => {
      try { this.handle(JSON.parse(line)); } catch (error) { this.emit('log', `Invalid Codex response: ${error.message}`); }
    });
    child.once('error', error => this.fail(error));
    child.once('exit', (code, signal) => this.fail(new Error(`codex app-server exited (${code ?? signal})`)));
    await this.call('initialize', { clientInfo: { name: 'codex_pocket', title: 'Codex Pocket', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }

  send(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex app-server is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  call(method, params = {}, timeoutMs = 30000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  handle(message) {
    if (message.id !== undefined && !message.method) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || 'Codex request failed'));
      else entry.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      // Keep server-initiated requests visible until a user answers them.
      this.requests.set(String(message.id), message);
    }
    this.emit('event', message);
  }

  answer(id, result) {
    const key = String(id);
    const request = this.requests.get(key);
    if (!request) throw new Error('Approval request has expired');
    this.send({ id: request.id, result });
    this.requests.delete(key);
  }

  fail(error) {
    if (!this.child) return;
    this.child = null;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    this.emit('error', error);
  }

  stop() { const child = this.child; this.child = null; child?.kill(); }
}
