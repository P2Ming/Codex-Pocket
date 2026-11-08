import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAppServer } from './app-server.mjs';

const htmlPath = fileURLToPath(new URL('./web/index.html', import.meta.url));
const jsPath = fileURLToPath(new URL('./web/app.js', import.meta.url));
const preferencesPath = fileURLToPath(new URL('./web/preferences.js', import.meta.url));
const questionsPath = fileURLToPath(new URL('./web/questions.js', import.meta.url));
const mobileHtmlPath = fileURLToPath(new URL('./web/mobile.html', import.meta.url));
const mobileJsPath = fileURLToPath(new URL('./web/mobile.js', import.meta.url));
const mobileCssPath = fileURLToPath(new URL('./web/mobile.css', import.meta.url));
const idPattern = /^[a-zA-Z0-9_-]{8,128}$/;

export function createPocketServer({ pin, host = '127.0.0.1', port = 3081, cwd = process.cwd(), codex = new CodexAppServer({ cwd }) } = {}) {
  if (!pin || pin.length < 12) throw new Error('CODEX_POCKET_PIN must contain at least 12 characters');
  const secret = randomBytes(32);
  const cookie = createHash('sha256').update(secret).update(pin).digest('hex');
  const failures = new Map();
  const listeners = new Set();
  const liveListeners = new Set();
  const activeTurns = new Map();
  const completedTurns = new Map();
  const turnLocks = new Set();
  const freshThreads = new Set();
  const monitorPaths = new Map();
  const monitorToken = randomBytes(32).toString('hex');
  const shellStates = new Map();
  let modelCatalog = [];
  let modelCatalogAt = 0;
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
  const send = (res, status, value) => { res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const authed = req => { const found = /(?:^|;\s*)codex_pocket=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || ''); return !!found && timingSafeEqual(Buffer.from(found[1]), Buffer.from(cookie)); };
  const body = async req => { let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 65536) throw new Error('Request too large'); } return JSON.parse(data || '{}'); };
  const models = async () => {
    if (Date.now() - modelCatalogAt > 60000) {
      const result = await codex.call('model/list', { limit: 100, includeHidden: false });
      modelCatalog = result.data || [];
      modelCatalogAt = Date.now();
    }
    return modelCatalog;
  };
  const modelChoice = async value => {
    if (value.model == null || value.model === '') return value.effort ? { error: 'Select a model for the reasoning level' } : { params: {} };
    if (typeof value.model !== 'string') return { error: 'Invalid model' };
    const model = (await models()).find(item => item.model === value.model);
    if (!model) return { error: 'Model is unavailable' };
    const params = { model: model.model };
    if (value.effort != null && value.effort !== '') {
      if (typeof value.effort !== 'string' || !(model.supportedReasoningEfforts || []).some(item => item.reasoningEffort === value.effort)) return { error: 'Reasoning level is unavailable for this model' };
      params.effort = value.effort;
    }
    return { params };
  };
  const codexEvents = event => {
    if (event.method === 'turn/started' && event.params?.threadId && event.params?.turn?.id) activeTurns.set(event.params.threadId, event.params.turn.id);
    if (event.method === 'turn/completed' && event.params?.threadId && event.params?.turn?.id) {
      if (activeTurns.get(event.params.threadId) === event.params.turn.id) activeTurns.delete(event.params.threadId);
      completedTurns.set(event.params.threadId, { id: event.params.turn.id, at: Date.now() });
    }
    const message = `data: ${JSON.stringify(event)}\n\n`; for (const res of listeners) res.write(message);
  };
  codex.on('event', codexEvents);
  codex.on('error', error => codexEvents({ method: 'bridge/error', params: { message: error.message } }));
  const latestCompletion = async threadId => {
    let latest = completedTurns.get(threadId) || null;
    try {
      let path = monitorPaths.get(threadId);
      if (!path) {
        const info = (await codex.call('thread/read', { threadId, includeTurns: true })).thread;
        path = info?.path;
        if (path && path.replaceAll('\\', '/').includes('/.codex/sessions/') && basename(path).endsWith(`${threadId}.jsonl`)) monitorPaths.set(threadId, path);
      }
      if (!path || !path.replaceAll('\\', '/').includes('/.codex/sessions/') || !basename(path).endsWith(`${threadId}.jsonl`)) return latest;
      const size = (await stat(path)).size;
      const length = Math.min(size, 262144);
      const file = await open(path, 'r');
      const buffer = Buffer.alloc(length);
      try { await file.read(buffer, 0, length, size - length); } finally { await file.close(); }
      const lines = buffer.toString('utf8').split('\n');
      for (let index = lines.length - 1; index >= 0; index--) {
        let record;
        try { record = JSON.parse(lines[index]); } catch { continue; }
        if (record.type !== 'event_msg' || record.payload?.type !== 'task_complete') continue;
        const id = record.payload.turn_id;
        const at = Date.parse(record.timestamp) || 0;
        if (id && (!latest || at >= latest.at)) latest = { id, at };
        break;
      }
    } catch { /* A newly created thread may not have a session log yet. */ }
    return latest;
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST') { const origin = req.headers.origin; if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return send(res, 403, { error: 'Invalid origin' }); }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const ip = req.socket.remoteAddress || ''; const record = failures.get(ip) || { count: 0, until: 0 };
        if (Date.now() < record.until) return send(res, 429, { error: 'Too many attempts. Try again later.' });
        const input = String((await body(req)).pin || '');
        const a = createHash('sha256').update(input).digest(); const b = createHash('sha256').update(pin).digest();
        if (!timingSafeEqual(a, b)) { record.count++; if (record.count >= 5) { record.until = Date.now() + 60000; record.count = 0; } failures.set(ip, record); return send(res, 401, { error: 'Incorrect PIN' }); }
        failures.delete(ip); const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || ''); res.setHeader('set-cookie', `codex_pocket=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${local ? '' : '; Secure'}`); return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/session') return send(res, 200, { authenticated: authed(req) });
      if (req.method === 'GET' && url.pathname === '/api/shell-state') {
        const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
        const state = bearer && shellStates.get(bearer[1]);
        if (!state) return send(res, 401, { error: 'Shell authorization required' });
        const command = state.command;
        state.command = '';
        state.touched = Date.now();
        const completed = state.threadId ? await latestCompletion(state.threadId) : null;
        return send(res, 200, { threadId: state.threadId, title: state.title, theme: state.theme, command,
          completedTurnId: completed?.id || '', completedAt: completed?.at || 0 });
      }
      if (req.method === 'GET' && url.pathname === '/api/monitor') {
        const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
        if (!bearer || !timingSafeEqual(Buffer.from(bearer[1]), Buffer.from(monitorToken))) return send(res, 401, { error: 'Monitor authorization required' });
        const threadId = url.searchParams.get('threadId') || '';
        if (!idPattern.test(threadId)) return send(res, 400, { error: 'Invalid thread id' });
        const completed = await latestCompletion(threadId);
        return send(res, 200, { completedTurnId: completed?.id || '', completedAt: completed?.at || 0 });
      }
      if (!authed(req)) { if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Login required' }); }
      else {
        if (req.method === 'POST' && url.pathname === '/api/shell-state') {
          const value = await body(req);
          if (!/^[a-f0-9]{64}$/.test(value.shellId || '') ||
              (value.threadId && !idPattern.test(value.threadId)) ||
              (value.command && value.command !== 'settings')) return send(res, 400, { error: 'Invalid shell state' });
          const state = shellStates.get(value.shellId) || { threadId: '', title: '', command: '' };
          if (typeof value.threadId === 'string') state.threadId = value.threadId;
          if (typeof value.title === 'string') state.title = value.title.slice(0, 60);
          if (value.theme === 'light' || value.theme === 'dark') state.theme = value.theme;
          if (value.command) state.command = value.command;
          state.touched = Date.now();
          shellStates.set(value.shellId, state);
          for (const [id, entry] of shellStates) if (Date.now() - entry.touched > 86400000) shellStates.delete(id);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && url.pathname === '/api/monitor-token') return send(res, 200, { token: monitorToken });
        if (req.method === 'GET' && url.pathname === '/api/events') { res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', connection: 'keep-alive' }); res.write(': connected\n\n'); listeners.add(res); req.on('close', () => listeners.delete(res)); return; }
        if (req.method === 'GET' && url.pathname === '/api/live') {
          const threadId = url.searchParams.get('threadId') || '';
          if (!idPattern.test(threadId)) return send(res, 400, { error: 'Invalid thread id' });
          const info = (await codex.call('thread/read', { threadId })).thread;
          const path = info?.path;
          if (!path || !path.replaceAll('\\', '/').includes('/.codex/sessions/') || !basename(path).endsWith(`${threadId}.jsonl`)) return send(res, 404, { error: 'Session log unavailable' });
          const initialSize = (await stat(path)).size;
          let offset = Math.max(0, initialSize - 262144);
          let partial = ''; let busy = false; let skipFirstLine = offset > 0;
          let decoder = new StringDecoder('utf8');
          res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', connection: 'keep-alive' });
          res.write(': connected\n\n');
          const poll = async () => {
            if (busy || res.destroyed) return; busy = true;
            try {
              const size = (await stat(path)).size;
              if (size < offset) { offset = size; partial = ''; }
              if (size > offset) {
                const length = Math.min(size - offset, 1024 * 1024);
                const file = await open(path, 'r'); const buffer = Buffer.alloc(length);
                let bytesRead;
                try { ({ bytesRead } = await file.read(buffer, 0, length, offset)); } finally { await file.close(); }
                if (!bytesRead) return;
                offset += bytesRead;
                const lines = (partial + decoder.write(buffer.subarray(0, bytesRead))).split('\n'); partial = lines.pop() || '';
                if (skipFirstLine) { lines.shift(); skipFirstLine = false; }
                for (const line of lines) {
                  let record; try { record = JSON.parse(line); } catch { continue; }
                  const payload = record.payload || {};
                  if (record.type !== 'event_msg') continue;
                  let event = null;
                  if (payload.type === 'task_started') event = { method: 'pocket/turnStarted', params: { threadId, turnId: payload.turn_id } };
                  if (payload.type === 'task_complete') event = { method: 'pocket/turnCompleted', params: { threadId, turnId: payload.turn_id } };
                  if (payload.type === 'item_completed' && ['AgentMessage', 'UserMessage'].includes(payload.item?.type)) event = { method: 'pocket/message', params: { threadId, turnId: payload.turn_id, itemId: payload.item.id, role: payload.item.type === 'UserMessage' ? 'user' : 'agent', text: payload.item.text || (payload.item.content || []).map(x => x.text || '').join('\n'), questions: payload.item.questions || [] } };
                  if (event) res.write(`data: ${JSON.stringify(event)}\n\n`);
                }
              }
            } catch { if (!res.destroyed) res.write(': waiting\n\n'); } finally { busy = false; }
          };
          const timer = setInterval(poll, 500); const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
          const cleanup = () => { clearInterval(timer); clearInterval(heartbeat); liveListeners.delete(res); };
          liveListeners.add(res); req.on('close', cleanup);
          void poll();
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/requests') return send(res, 200, [...codex.requests.values()]);
        if (req.method === 'GET' && url.pathname === '/api/models') return send(res, 200, { data: await models() });
        if (req.method === 'GET' && url.pathname === '/api/threads') return send(res, 200, await codex.call('thread/list', { limit: 50, sortKey: 'updated_at' }));
        if (req.method === 'GET' && url.pathname.startsWith('/api/threads/')) {
          const id = url.pathname.split('/')[3];
          if (!idPattern.test(id)) return send(res, 400, { error: 'Invalid thread id' });
          const result = await codex.call('thread/read', { threadId: id, includeTurns: true });
          const after = url.searchParams.get('after');
          if (!after || !result.thread?.turns) return send(res, 200, result);
          const items = result.thread.turns.flatMap(turn => turn.items || []);
          const cursor = items.findIndex(item => item.id === after);
          if (cursor < 0) return send(res, 200, result);
          return send(res, 200, { thread: { id, model: result.thread.model, reasoningEffort: result.thread.reasoningEffort,
            turns: [{ status: result.thread.turns.at(-1)?.status, items: items.slice(cursor) }] }, partial: true });
        }
        if (req.method === 'POST' && url.pathname === '/api/threads') { const value = await body(req); const choice = await modelChoice(value); if (choice.error) return send(res, 400, choice); const params = { cwd: value.cwd || cwd, ...(choice.params.model ? { model: choice.params.model } : {}) }; const result = await codex.call('thread/start', params); if (result?.thread?.id) freshThreads.add(result.thread.id); return send(res, 200, result); }
        if (req.method === 'POST' && url.pathname === '/api/turns') {
          const value = await body(req);
          if (!idPattern.test(value.threadId || '') || typeof value.text !== 'string' || !value.text.trim()) return send(res, 400, { error: 'Invalid turn' });
          const choice = await modelChoice(value);
          if (choice.error) return send(res, 400, choice);
          if (turnLocks.has(value.threadId)) return send(res, 409, { code: 'TURN_BUSY', error: '上一条消息仍在提交，请稍后重试。' });
          turnLocks.add(value.threadId);
          try {
            const input = [{ type: 'text', text: value.text }];
            const running = activeTurns.get(value.threadId);
            if (running) return send(res, 200, { steered: true, ...(await codex.call('turn/steer', { threadId: value.threadId, expectedTurnId: running, input })) });
            if (!freshThreads.has(value.threadId)) await codex.call('thread/resume', { threadId: value.threadId });
            const result = await codex.call('turn/start', { threadId: value.threadId, input, ...choice.params });
            freshThreads.delete(value.threadId);
            if (result?.turn?.id) activeTurns.set(value.threadId, result.turn.id);
            return send(res, 200, result);
          } finally { turnLocks.delete(value.threadId); }
        }
        if (req.method === 'POST' && url.pathname === '/api/answer') {
          const value = await body(req);
          const request = codex.requests.get(String(value.id));
          if (!request) return send(res, 404, { error: 'Request expired' });
          if (request.method === 'item/tool/requestUserInput') {
            const questions = request.params?.questions || [];
            if (!questions.length || !value.answers || typeof value.answers !== 'object' ||
                questions.some(question => { const answers = value.answers[question.id]?.answers; return !Array.isArray(answers) || answers.length !== 1 || typeof answers[0] !== 'string' || !answers[0].trim() || answers[0].length > 4096; })) return send(res, 400, { error: 'Invalid answer' });
            codex.answer(value.id, { answers: Object.fromEntries(questions.map(question => [question.id, { answers: [value.answers[question.id].answers[0].trim()] }])) });
            return send(res, 200, { ok: true });
          }
          if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method)) return send(res, 400, { error: 'This request must be answered in Codex Desktop' });
          codex.answer(value.id, { decision: value.approve ? 'accept' : 'decline' });
          return send(res, 200, { ok: true });
        }
      }
      if (req.method === 'GET') {
        const pages = new Map([
          ['/', [htmlPath, 'text/html']],
          ['/app.js', [jsPath, 'text/javascript']],
          ['/preferences.js', [preferencesPath, 'text/javascript']],
          ['/questions.js', [questionsPath, 'text/javascript']],
          ['/app', [mobileHtmlPath, 'text/html']],
          ['/mobile.js', [mobileJsPath, 'text/javascript']],
          ['/mobile.css', [mobileCssPath, 'text/css']]
        ]);
        const asset = pages.get(url.pathname);
        if (asset) { res.writeHead(200, { ...headers, 'content-type': asset[1] + '; charset=utf-8' }); res.end(await readFile(asset[0])); return; }
      }
      send(res, 404, { error: 'Not found' });
    } catch (error) {
      if (/already has an active writer/i.test(error.message)) return send(res, 409, { code: 'THREAD_ACTIVE_WRITER', error: 'Codex Desktop 仍持有此会话的写入权。回复结束不等于释放会话；请退出 Codex Desktop 后重试。消息仍保留在输入框中。' });
      send(res, 500, { error: error.message });
    }
  });
  return { codex, server, async start() { await codex.start(); await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve)); return server.address(); }, async stop() { codex.stop(); for (const res of [...listeners, ...liveListeners]) res.end(); await new Promise(resolve => server.close(resolve)); } };
}
