const $ = id => document.getElementById(id);
let active = null;
let threads = [];
let events = null;
let live = null;
let sending = false;
let selection = 0;
let availableModels = [];
const pendingThreads = new Map();
const messages = new Map();
const pendingUsers = new Set();

function fillSelect(select, entries) {
  select.replaceChildren();
  for (const [value, label] of entries) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}
function updateEfforts(preferred = '') {
  const model = availableModels.find(item => item.model === $('modelSelect').value);
  const efforts = model?.supportedReasoningEfforts || [];
  const labels = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大', ultra: '极致' };
  fillSelect($('effortSelect'), [['', '默认'], ...efforts.map(item => [item.reasoningEffort, labels[item.reasoningEffort] || item.reasoningEffort])]);
  $('effortSelect').disabled = !model || !efforts.length;
  $('effortSelect').value = efforts.some(item => item.reasoningEffort === preferred) ? preferred : '';
}
function chooseModel(model = '', effort = '') {
  $('modelSelect').value = availableModels.some(item => item.model === model) ? model : '';
  updateEfforts(effort);
}
async function loadModels() {
  const result = await api('models');
  availableModels = result.data || [];
  fillSelect($('modelSelect'), [['', '默认模型'], ...availableModels.map(item => [item.model, item.displayName || item.model])]);
  chooseModel();
}

function notice(message) {
  const box = $('notice');
  box.replaceChildren();
  if (!message) return;
  box.append(document.createTextNode(message));
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '关闭';
  close.onclick = () => box.replaceChildren();
  box.append(close);
}
function setRunning(value) {
  $('turnState').textContent = value ? '● 运行中' : '✓ 已结束';
  $('composer').querySelector('button').textContent = value ? '发送引导' : '发送';
}
async function api(path, options = {}) {
  const response = await fetch('/api/' + path, { credentials: 'same-origin', ...options });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'HTTP ' + response.status);
    error.code = data.code;
    throw error;
  }
  return data;
}
const post = (path, data) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
function itemText(item) {
  if (item.type === 'userMessage') return { role: 'user', text: (item.content || []).map(x => x.text || '').join('\n') };
  if (item.type === 'agentMessage') return { role: 'agent', text: item.text || (item.content || []).map(x => x.text || '').join('\n') };
  return null;
}
function addMessage(role, text, id, append = false) {
  if (!text) return null;
  const box = $('messages');
  box.querySelector('.empty-state')?.remove();
  let element = id && messages.get(id);
  if (!element && role === 'user' && !append) {
    for (const candidate of pendingUsers) {
      if (candidate.querySelector('.content').textContent === text) {
        element = candidate;
        pendingUsers.delete(candidate);
        break;
      }
    }
  }
  if (!element && id && !append) {
    const last = box.lastElementChild;
    if (last?.dataset.role === role && last.querySelector('.content')?.textContent === text) element = last;
  }
  if (!element) {
    element = document.createElement('div');
    element.className = 'item ' + role;
    element.dataset.role = role;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = role === 'user' ? '你' : 'Codex';
    const content = document.createElement('div');
    content.className = 'content';
    element.append(meta, content);
    box.append(element);
  }
  const content = element.querySelector('.content');
  content.textContent = append ? content.textContent + text : text;
  if (id) messages.set(id, element);
  if (!box.querySelector('.question-panel')) box.scrollTop = box.scrollHeight;
  return element;
}
async function loadThreads() {
  const result = await api('threads');
  threads = result.data || result.threads || [];
  for (const [id, thread] of pendingThreads) {
    const index = threads.findIndex(item => item.id === id);
    if (index < 0) threads.unshift(thread);
    else if (thread.fresh) threads[index] = { ...thread, ...threads[index], model: threads[index].model || thread.model, reasoningEffort: threads[index].reasoningEffort || thread.reasoningEffort, fresh: true };
    else pendingThreads.delete(id);
  }
  renderThreads();
}
function renderThreads() {
  const list = $('threads');
  list.replaceChildren();
  for (const thread of threads) {
    const button = document.createElement('button');
    button.className = 'thread';
    button.type = 'button';
    button.textContent = thread.name || thread.preview || thread.id;
    button.title = thread.id;
    button.onclick = () => selectThread(thread.id, pendingThreads.get(thread.id)?.fresh);
    list.append(button);
  }
}
async function selectThread(id, fresh = false) {
  const generation = ++selection;
  active = id;
  live?.close();
  messages.clear();
  pendingUsers.clear();
  $('messages').replaceChildren();
  notice('');
  const thread = threads.find(x => x.id === id);
  $('title').firstChild.textContent = (thread?.name || thread?.preview || id) + ' ';
  chooseModel(thread?.model, thread?.reasoningEffort);
  $('turnState').textContent = '加载中…';
  if (fresh) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('h2');
    title.textContent = '新会话已就绪';
    empty.append(title);
    $('messages').append(empty);
    $('turnState').textContent = '已就绪';
    return;
  }
  try {
    const result = await api('threads/' + encodeURIComponent(id));
    if (generation !== selection) return;
    const turns = (result.thread || result).turns || [];
    chooseModel((result.thread || result).model, (result.thread || result).reasoningEffort);
    let unanswered = null;
    for (const turn of turns) for (const item of turn.items || []) {
      const message = itemText(item);
      if (message?.text) {
        const element = addMessage(message.role, message.text, item.id);
        if (message.role === 'user' && unanswered && PocketQuestions.isAnswer(unanswered.questions, message.text)) unanswered = null;
        if (message.role === 'agent' && item.questions?.length) unanswered = { element, questions: item.questions };
      }
    }
    if (unanswered) showChoices(unanswered.element, unanswered.questions);
    setRunning(['inProgress', 'in_progress', 'running'].includes(turns.at(-1)?.status));
    connectLive(id);
  } catch (error) {
    if (generation === selection) notice('读取会话失败：' + error.message);
  }
}
function connectLive(id) {
  live?.close();
  live = new EventSource('/api/live?threadId=' + encodeURIComponent(id));
  live.onopen = () => { if (active === id) $('status').textContent = '已连接'; };
  live.onerror = () => { if (active === id) $('status').textContent = '重连中'; };
  live.onmessage = e => {
    if (active !== id) return;
    let event;
    try { event = JSON.parse(e.data); } catch { return; }
    const p = event.params || {};
    if (p.threadId !== id) return;
    if (event.method === 'pocket/turnStarted') setRunning(true);
    if (event.method === 'pocket/turnCompleted') setRunning(false);
    if (event.method === 'pocket/message') {
      const element = addMessage(p.role, p.text, p.itemId);
      if (p.role === 'user') PocketQuestions.clear($('messages'));
      if (p.role === 'agent' && p.questions?.length) showChoices(element, p.questions);
    }
  };
}
function showChoices(element, questions) {
  PocketQuestions.show(element, questions, async (answers, fields) => {
    const text = fields.length === 1 ? answers[fields[0].id].answers[0] : fields.map(field => `${field.title}：${answers[field.id].answers[0]}`).join('\n');
    $('prompt').value = text;
    return sendText(text);
  });
  requestAnimationFrame(() => element.querySelector('.question-panel')?.scrollIntoView({ block: 'center' }));
}
async function showRequests() {
  const requests = await api('requests');
  $('approvals').replaceChildren();
  for (const request of requests) {
    if (request.method === 'item/tool/requestUserInput') {
      const box = document.createElement('div');
      box.className = 'approval input-request';
      $('approvals').append(box);
      PocketQuestions.show(box, request.params?.questions, async answers => {
        try { await post('answer', { id: request.id, answers }); await showRequests(); return true; }
        catch (error) { notice('提交回答失败：' + error.message); return false; }
      });
      continue;
    }
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method)) continue;
    const box = document.createElement('div');
    box.className = 'approval';
    const title = document.createElement('strong');
    title.textContent = request.method.includes('command') ? '命令执行审批' : '文件修改审批';
    const detail = document.createElement('pre');
    detail.textContent = request.params?.command || request.params?.reason || JSON.stringify(request.params, null, 2);
    const yes = document.createElement('button');
    yes.textContent = '允许一次';
    yes.onclick = () => answer(request.id, true);
    const no = document.createElement('button');
    no.textContent = '拒绝';
    no.style.marginLeft = '8px';
    no.onclick = () => answer(request.id, false);
    box.append(title, detail, yes, no);
    $('approvals').append(box);
  }
}
async function answer(id, approve) {
  try { await post('answer', { id, approve }); await showRequests(); }
  catch (error) { notice('审批失败：' + error.message); }
}
function connect() {
  events?.close();
  events = new EventSource('/api/events');
  events.onopen = () => $('status').textContent = '已连接';
  events.onerror = () => $('status').textContent = '重连中';
  events.onmessage = e => {
    let event;
    try { event = JSON.parse(e.data); } catch { return; }
    const p = event.params || {};
    if (event.method === 'bridge/error') $('status').textContent = p.message;
    if (event.method?.includes('requestApproval') || event.method === 'item/tool/requestUserInput') void showRequests();
    if (event.method === 'thread/started') void loadThreads();
    if (p.threadId !== active) return;
    if (event.method === 'turn/started') setRunning(true);
    if (event.method === 'turn/completed') setRunning(false);
    if (event.method === 'item/agentMessage/delta' && typeof p.delta === 'string') addMessage('agent', p.delta, p.itemId, true);
    if (event.method === 'item/completed') {
      const message = itemText(p.item || {});
      if (message?.text) {
        const element = addMessage(message.role, message.text, p.item.id);
        if (message.role === 'user') PocketQuestions.clear($('messages'));
        if (message.role === 'agent' && p.item.questions?.length) showChoices(element, p.item.questions);
      }
    }
  };
}
async function start() {
  $('login').hidden = true;
  connect();
  const results = await Promise.allSettled([loadModels(), loadThreads(), showRequests()]);
  for (const result of results) if (result.status === 'rejected') notice('加载失败：' + result.reason.message);
}
$('loginForm').onsubmit = async event => {
  event.preventDefault();
  try { await post('login', { pin: $('pin').value }); $('pin').value = ''; await start(); }
  catch (error) { $('error').textContent = error.message; }
};
$('new').onclick = async () => {
  try { const model = $('modelSelect').value; const effort = $('effortSelect').value; const result = await post('threads', { model }); const id = result.thread?.id; if (!id) throw new Error('服务器未返回会话 ID'); const thread = { id, name: '新会话', model, reasoningEffort: effort, fresh: true }; pendingThreads.set(id, thread); threads.unshift(thread); renderThreads(); await selectThread(id, true); }
  catch (error) { notice('创建失败：' + error.message); }
};
$('modelSelect').onchange = () => updateEfforts();
async function sendText(text) {
  if (!active) { notice('先选择或创建任务'); return false; }
  if (!text || sending) return false;
  const threadId = active;
  const model = $('modelSelect').value;
  const effort = $('effortSelect').value;
  sending = true;
  const button = $('composer').querySelector('button');
  button.disabled = true;
  notice('');
  try {
    await post('turns', { threadId, text, model, effort });
    if (pendingThreads.has(threadId)) pendingThreads.get(threadId).fresh = false;
    if (active === threadId) {
      $('prompt').value = '';
      PocketQuestions.clear($('messages'));
      pendingUsers.add(addMessage('user', text));
      setRunning(true);
      const thread = threads.find(item => item.id === threadId);
      if (thread && model) { thread.model = model; thread.reasoningEffort = effort || thread.reasoningEffort; }
    }
    void loadThreads().catch(() => {});
    return true;
  } catch (error) { notice('发送失败：' + error.message); return false; }
  finally { sending = false; button.disabled = false; }
};
$('composer').onsubmit = event => { event.preventDefault(); void sendText($('prompt').value.trim()); };
api('session').then(session => { if (session.authenticated) void start(); }).catch(error => $('error').textContent = error.message);
