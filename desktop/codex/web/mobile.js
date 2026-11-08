const $ = id => document.getElementById(id);
let active = null, currentThreads = [], source = null, liveSource = null, sending = false, selection = 0;
let availableModels = [];
const pendingThreads = new Map();
const messages = new Map();
const pendingUserMessages = new Set();
const completedNotifications = new Set();
const threadCache = new Map();
const cacheDatabase = new Promise(resolve => {
  if (!window.indexedDB) return resolve(null);
  const request = indexedDB.open('codex-pocket-history', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('threads');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => resolve(null);
});
let cacheTimer = null;
async function readCachedThread(id) {
  if (threadCache.has(id)) return threadCache.get(id);
  const database = await cacheDatabase;
  if (!database) return null;
  return new Promise(resolve => {
    const request = database.transaction('threads', 'readonly').objectStore('threads').get(id);
    request.onsuccess = () => { if (request.result) threadCache.set(id, request.result); resolve(request.result || null); };
    request.onerror = () => resolve(null);
  });
}
async function saveCachedThread(id, snapshot) {
  threadCache.set(id, snapshot);
  const database = await cacheDatabase;
  if (!database) return;
  try { database.transaction('threads', 'readwrite').objectStore('threads').put(snapshot, id); } catch {}
}
function captureThread() {
  if (!active) return;
  clearTimeout(cacheTimer);
  const items = [...$('messages').querySelectorAll('.item[data-item-id]')].map(element => ({
    id: element.dataset.itemId, role: element.dataset.role,
    text: element.querySelector('.content')?.textContent || '',
    questions: element.querySelector('.question-panel') ? element._pocketQuestions || [] : []
  }));
  if (!items.length) return;
  void saveCachedThread(active, { items, model: $('modelSelect').value,
    reasoningEffort: $('effortSelect').value, running: $('turnState').classList.contains('running') });
}
function scheduleCache() { clearTimeout(cacheTimer); cacheTimer = setTimeout(captureThread, 400); }
const embeddedShell = new URLSearchParams(location.search).get('shell') === '1';
const shellId = new URLSearchParams(location.search).get('shellId') || '';
const activeThreadKey = 'codex-pocket-active-thread';
let nativeKeyboardInset = 0;
let baselineViewportHeight = window.visualViewport?.height || window.innerHeight;
function shellCall(code) {
  try {
    const webview = window.plus?.webview;
    let current;
    try { current = webview?.currentWebview?.(); } catch {}
    const candidates = [];
    for (const get of [() => current?.opener?.(), () => current?.parent?.(), () => webview?.getLaunchWebview?.()]) {
      try { candidates.push(get()); } catch {}
    }
    const seen = new Set();
    let sent = false;
    for (const target of candidates) {
      if (!target || target === current || seen.has(target)) continue;
      seen.add(target);
      try { target.evalJS(code); sent = true; } catch {}
    }
    return sent;
  } catch { /* The page also runs in a browser. */ }
  return false;
}
$('shellSettings').onclick = async () => {
  if (!shellId) { notice('请安装 1.0.2 版应用后使用设置。'); return; }
  try { await post('shell-state', { shellId, command: 'settings', theme: document.documentElement.dataset.theme }); }
  catch (error) { notice('无法打开设置：' + error.message); }
};
function syncShellMonitor() {
  if (!embeddedShell || !shellId) return;
  const title = currentThreads.find(thread => thread.id === active)?.name || (active ? $('title').textContent : 'Codex Pocket');
  void post('shell-state', { shellId, threadId: active || '', title, theme: document.documentElement.dataset.theme }).catch(() => {});
}
window.syncPocketShell = syncShellMonitor;
function syncViewport() {
  if (!embeddedShell) return;
  const visible = window.visualViewport?.height || window.innerHeight;
  if (!nativeKeyboardInset && !document.activeElement?.matches('input,textarea,[contenteditable="true"]')) baselineViewportHeight = visible;
  const viewportShrink = Math.max(0, baselineViewportHeight - visible);
  const height = Math.max(180, visible - Math.max(0, nativeKeyboardInset - viewportShrink));
  document.documentElement.style.setProperty('--pocket-viewport-height', Math.round(height) + 'px');
}
window.PocketKeyboard = { setInset(value) { nativeKeyboardInset = Math.max(0, Number(value) || 0); syncViewport(); } };
syncViewport();
window.visualViewport?.addEventListener('resize', syncViewport);
window.addEventListener('resize', syncViewport);
$('prompt').addEventListener('focus', () => setTimeout(syncViewport, 100));
function notifyCompletion(id, turnId) {
  if (!embeddedShell) return;
  const key = id + ':' + (turnId || 'unknown');
  if (completedNotifications.has(key)) return;
  completedNotifications.add(key);
  if (completedNotifications.size > 100) completedNotifications.delete(completedNotifications.values().next().value);
  const title = currentThreads.find(thread => thread.id === id)?.name || $('title').textContent;
  if (!shellId) shellCall(`window.notifyPocketDone(${JSON.stringify({ threadId: id, turnId, title })})`);
}
function notice(message) { const box = $('notice'); box.replaceChildren(); if (!message) return; box.append(document.createTextNode(message)); const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.setAttribute('aria-label', '关闭提示'); close.onclick = () => box.replaceChildren(); box.append(close); }
function setRunning(value) { $('turnState').textContent = value ? '● 运行中' : '已结束'; $('turnState').classList.toggle('running', value); $('mobileTurnState').textContent = value ? '● 运行中' : '已结束'; $('mobileTurnState').classList.toggle('running', value); $('sendLabel').textContent = value ? '引导' : '发送'; scheduleCache(); }
function setConnection(message, retry = false) { $('status').textContent = message; $('status').classList.toggle('retry', retry); }
function showMenu(show) { $('sidebar').classList.toggle('open', show); $('drawerBackdrop').hidden = !show; $('menu').setAttribute('aria-expanded', String(show)); }
window.PocketBack = () => { if ($('sidebar').classList.contains('open')) showMenu(false); };
if (embeddedShell) {
  const guardBack = () => history.pushState({ pocketBackGuard: true }, '', location.href);
  guardBack();
  window.addEventListener('popstate', () => { window.PocketBack(); guardBack(); });
}
function resizePrompt() { const input = $('prompt'); input.style.height = 'auto'; input.style.height = Math.min(180, Math.max(48, input.scrollHeight)) + 'px'; }
function fillSelect(select, entries) { select.replaceChildren(); for (const [value, label] of entries) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); } }
function updateEfforts(preferred = '') { const model = availableModels.find(item => item.model === $('modelSelect').value); const efforts = model?.supportedReasoningEfforts || []; const labels = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大', ultra: '极致' }; fillSelect($('effortSelect'), [['', '默认'], ...efforts.map(item => [item.reasoningEffort, labels[item.reasoningEffort] || item.reasoningEffort])]); $('effortSelect').disabled = !model || !efforts.length; $('effortSelect').value = efforts.some(item => item.reasoningEffort === preferred) ? preferred : ''; }
function chooseModel(model = '', effort = '') { $('modelSelect').value = availableModels.some(item => item.model === model) ? model : ''; updateEfforts(effort); }
async function loadModels() { const result = await api('models'); availableModels = result.data || []; fillSelect($('modelSelect'), [['', '默认模型'], ...availableModels.map(item => [item.model, item.displayName || item.model])]); chooseModel(); }
async function api(path, options) { const r = await fetch('/api/' + path, { credentials: 'same-origin', ...options }); const data = await r.json(); if (!r.ok) { const error = Error(data.error || 'HTTP ' + r.status); error.status = r.status; error.code = data.code; throw error; } return data; }
function post(path, data) { return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); }
function itemText(item) { if (item.type === 'userMessage') return { role: 'user', text: (item.content || []).map(x => x.text || '').join('\n') }; if (item.type === 'agentMessage') return { role: 'agent', text: item.text || (item.content || []).map(x => x.text || '').join('\n') }; return null; }
function addMessage(role, text, id, append = false) { if (!text) return; $('emptyState')?.remove(); const box = $('messages'); let el = id && messages.get(id); if (!el && !append) { if (role === 'user') { for (const candidate of pendingUserMessages) if (candidate.querySelector('.content')?.textContent === text) { el = candidate; pendingUserMessages.delete(candidate); break; } } if (!el) { const last = box.lastElementChild; if (last?.dataset.role === role && last.querySelector('.content')?.textContent === text) el = last; } } if (!el) { el = document.createElement('div'); el.className = 'item ' + role; el.dataset.role = role; const head = document.createElement('div'); head.className = 'meta'; head.textContent = role === 'user' ? '你' : 'Codex'; const content = document.createElement('div'); content.className = 'content'; el.append(head, content); box.append(el); } const content = el.querySelector('.content'); content.textContent = append ? content.textContent + text : text; if (id) { el.dataset.itemId = id; messages.set(id, el); scheduleCache(); } if (!box.querySelector('.question-panel')) box.scrollTop = box.scrollHeight; return el; }
function renderThreads() { const filter = $('threadSearch').value.trim().toLowerCase(); const box = $('threads'); box.replaceChildren(); const found = currentThreads.filter(t => (t.name || t.preview || t.id).toLowerCase().includes(filter)); $('threadCount').textContent = String(found.length); for (const t of found) { const b = document.createElement('button'); b.className = 'thread' + (t.id === active ? ' selected' : ''); b.type = 'button'; b.title = t.id; const title = document.createElement('span'); title.className = 'thread-title'; title.textContent = t.name || t.preview || t.id; const sub = document.createElement('span'); sub.className = 'thread-sub'; sub.textContent = t.id.slice(0, 8); b.append(title, sub); b.onclick = () => selectThread(t.id, { fresh: pendingThreads.get(t.id)?.fresh }); box.append(b); } }
async function loadThreads() { const result = await api('threads'); currentThreads = result.data || result.threads || []; for (const [id, thread] of pendingThreads) { const index = currentThreads.findIndex(item => item.id === id); if (index < 0) currentThreads.unshift(thread); else if (thread.fresh) currentThreads[index] = { ...thread, ...currentThreads[index], model: currentThreads[index].model || thread.model, reasoningEffort: currentThreads[index].reasoningEffort || thread.reasoningEffort, fresh: true }; else pendingThreads.delete(id); } renderThreads(); }
async function selectThread(id, { fresh = false } = {}) { if (id === active && !fresh) { showMenu(false); return; } captureThread(); const generation = ++selection; active = id; if (embeddedShell) localStorage.setItem(activeThreadKey, id); showMenu(false); renderThreads(); liveSource?.close(); messages.clear(); pendingUserMessages.clear(); $('messages').replaceChildren(); notice(''); $('turnState').textContent = '加载中…'; $('mobileTurnState').textContent = '加载中'; const t = currentThreads.find(x => x.id === id); $('title').textContent = t?.name || t?.preview || id; syncShellMonitor(); chooseModel(t?.model, t?.reasoningEffort); if (fresh) { showEmptyThread(); $('turnState').textContent = '已就绪'; $('mobileTurnState').textContent = '待机'; return; } const cached = await readCachedThread(id); if (generation !== selection) return; if (cached?.items?.length) { for (const item of cached.items) { const element = addMessage(item.role, item.text, item.id); if (item.questions?.length) showChoices(element, item.questions); } chooseModel(cached.model, cached.reasoningEffort); setRunning(cached.running); } connectLive(id); try { await refreshThread(id, generation, cached?.items?.at(-1)?.id); } catch (error) { if (generation === selection) notice('读取会话失败：' + error.message); } }
function showEmptyThread() { const empty = document.createElement('div'); empty.id = 'emptyState'; empty.className = 'empty-state'; const title = document.createElement('h2'); title.textContent = '新会话已就绪'; const hint = document.createElement('p'); hint.textContent = '在下方输入消息，开始与 Codex 协作。'; empty.append(title, hint); $('messages').append(empty); }
async function refreshThread(id = active, generation = selection, after = '') { if (!id) return; const result = await api('threads/' + encodeURIComponent(id) + (after ? '?after=' + encodeURIComponent(after) : '')); if (generation !== selection || id !== active) return; const thread = result.thread || result; chooseModel(thread.model, thread.reasoningEffort); const turns = thread.turns || []; const box = $('messages'); if (!result.partial) { box.replaceChildren(); messages.clear(); } let unanswered = null; for (const turn of turns) for (const item of turn.items || []) { const message = itemText(item); if (message?.text) { const element = addMessage(message.role, message.text, item.id); if (message.role === 'user') { if (unanswered && PocketQuestions.isAnswer(unanswered.questions, message.text)) unanswered = null; if (result.partial) PocketQuestions.clear(box); } if (message.role === 'agent' && item.questions?.length) unanswered = { element, questions: item.questions }; } } if (unanswered) showChoices(unanswered.element, unanswered.questions); if (!box.children.length) showEmptyThread(); const last = turns.at(-1); setRunning(['inProgress','in_progress','running'].includes(last?.status)); box.scrollTop = box.scrollHeight; captureThread(); }
function showChoices(element, questions) { element._pocketQuestions = questions; PocketQuestions.show(element, questions, async (answers, fields) => { const text = fields.length === 1 ? answers[fields[0].id].answers[0] : fields.map(field => `${field.title}：${answers[field.id].answers[0]}`).join('\n'); $('prompt').value = text; resizePrompt(); return sendText(text); }); scheduleCache(); requestAnimationFrame(() => element.querySelector('.question-panel')?.scrollIntoView({ block: 'center' })); }
function connectLive(id) { liveSource?.close(); liveSource = new EventSource('/api/live?threadId=' + encodeURIComponent(id)); liveSource.onmessage = e => { if (active !== id) return; let event; try { event = JSON.parse(e.data); } catch { return; } const p = event.params || {}; if (p.threadId !== id) return; if (event.method === 'pocket/turnStarted') setRunning(true); if (event.method === 'pocket/turnCompleted') { setRunning(false); notifyCompletion(id, p.turnId); } if (event.method === 'pocket/message') { const element = addMessage(p.role, p.text, p.itemId); if (p.role === 'user') PocketQuestions.clear($('messages')); if (p.role === 'agent' && p.questions?.length) showChoices(element, p.questions); } }; liveSource.onerror = () => { if (active === id) setConnection('重连中', true); }; liveSource.onopen = () => { if (active === id) setConnection('已连接'); }; }
async function showRequests() { const requests = await api('requests'); $('approvals').replaceChildren(); for (const request of requests) { const box = document.createElement('div'); box.className = 'approval'; if (request.method === 'item/tool/requestUserInput') { box.classList.add('input-request'); $('approvals').append(box); PocketQuestions.show(box, request.params?.questions, async answers => { try { await post('answer', { id: request.id, answers }); await showRequests(); return true; } catch (error) { notice('提交回答失败：' + error.message); return false; } }); continue; } if (!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(request.method)) continue; const title = document.createElement('strong'); title.textContent = request.method.includes('command') ? '命令执行审批' : '文件修改审批'; const detail = document.createElement('pre'); detail.textContent = request.params?.command || request.params?.reason || JSON.stringify(request.params, null, 2); const yes = document.createElement('button'); yes.textContent = '允许一次'; yes.onclick = () => answer(request.id, true); const no = document.createElement('button'); no.textContent = '拒绝'; no.style.marginLeft = '8px'; no.onclick = () => answer(request.id, false); box.append(title, detail, yes, no); $('approvals').append(box); } }
async function answer(id, approve) { try { await post('answer', { id, approve }); await showRequests(); } catch (e) { alert(e.message); } }
function connect() { source?.close(); source = new EventSource('/api/events'); source.onopen = () => { if (!active) setConnection('已连接'); }; source.onerror = () => setConnection('重连中', true); source.onmessage = e => { let event; try { event = JSON.parse(e.data); } catch { return; } const p = event.params || {}; if (event.method === 'bridge/error') setConnection(p.message, true); if (event.method?.includes('requestApproval') || event.method === 'item/tool/requestUserInput') void showRequests(); if (event.method === 'thread/started') void loadThreads(); if (p.threadId !== active) return; if (event.method === 'turn/started') setRunning(true); if (event.method === 'turn/completed') { setRunning(false); notifyCompletion(active, p.turn?.id); } if (event.method === 'item/agentMessage/delta' && typeof p.delta === 'string') addMessage('agent', p.delta, p.itemId, true); if (event.method === 'item/completed') { const message = itemText(p.item || {}); if (message?.text) { const element = addMessage(message.role, message.text, p.item.id); if (message.role === 'user') PocketQuestions.clear($('messages')); if (message.role === 'agent' && p.item.questions?.length) showChoices(element, p.item.questions); } } }; }
async function start() { $('login').hidden = true; connect(); const results = await Promise.allSettled([loadModels(), loadThreads(), showRequests()]); for (const result of results) if (result.status === 'rejected') notice('加载失败：' + result.reason.message); if (embeddedShell && !active) { const latest = currentThreads[0]; if (latest) await selectThread(latest.id, { fresh: pendingThreads.get(latest.id)?.fresh }); } syncShellMonitor(); }
const rememberedPinKey = 'codex-pocket-remembered-pin';
const savedPin = embeddedShell ? localStorage.getItem(rememberedPinKey) : null;
$('rememberPin').closest('.remember-row').hidden = !embeddedShell;
if (savedPin) { $('pin').value = savedPin; $('rememberPin').checked = true; }
async function login(pin, automatic = false) { try { await post('login', { pin }); if (embeddedShell) { if ($('rememberPin').checked) localStorage.setItem(rememberedPinKey, pin); else localStorage.removeItem(rememberedPinKey); } $('pin').value = ''; await start(); } catch (error) { if (automatic) { localStorage.removeItem(rememberedPinKey); $('rememberPin').checked = false; } $('error').textContent = error.message; } }
$('loginForm').onsubmit = e => { e.preventDefault(); void login($('pin').value); };
$('new').onclick = async () => { try { const model = $('modelSelect').value; const effort = $('effortSelect').value; const result = await post('threads', { model }); const id = result.thread?.id; if (!id) throw new Error('服务器未返回会话 ID'); const thread = { id, name: '新会话', model, reasoningEffort: effort, fresh: true }; pendingThreads.set(id, thread); currentThreads.unshift(thread); await selectThread(id, { fresh: true }); } catch (error) { notice('创建会话失败：' + error.message); } };
$('modelSelect').onchange = () => updateEfforts();
$('menu').onclick = () => showMenu(true);
$('closeMenu').onclick = () => showMenu(false);
$('drawerBackdrop').onclick = () => showMenu(false);
$('threadSearch').oninput = renderThreads;
$('prompt').oninput = resizePrompt;
async function sendText(text) { if (!active) { notice('先选择或创建会话'); return false; } if (!text || sending) return false; const threadId = active; const model = $('modelSelect').value; const effort = $('effortSelect').value; sending = true; $('send').disabled = true; notice(''); try { await post('turns', { threadId, text, model, effort }); if (pendingThreads.has(threadId)) pendingThreads.get(threadId).fresh = false; if (active === threadId) { $('prompt').value = ''; resizePrompt(); PocketQuestions.clear($('messages')); pendingUserMessages.add(addMessage('user', text)); setRunning(true); const thread = currentThreads.find(item => item.id === threadId); if (thread && model) { thread.model = model; thread.reasoningEffort = effort || thread.reasoningEffort; } } void loadThreads().catch(() => {}); return true; } catch (error) { notice('发送失败：' + error.message); return false; } finally { sending = false; $('send').disabled = false; } }
$('composer').onsubmit = e => { e.preventDefault(); void sendText($('prompt').value.trim()); };
api('session').then(s => { if (s.authenticated) start(); else if (savedPin) void login(savedPin, true); }).catch(e => $('error').textContent = e.message);
