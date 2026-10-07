// @ts-check
// Native UI only: one paste and, after validation, at most one Send click.
const COMPOSER = '[data-lexical-editor="true"][contenteditable="true"][role="textbox"]';
const MODEL = 'button[aria-label^="Select a model "]';
const SEND = 'button[aria-label="Send"]';
const onGrok = () => /^\/i\/grok(?:\/|$)/.test(location.pathname);
const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible' && !element.closest('[hidden], [inert], [aria-hidden="true"]');
const text = (editor) => (editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n');
const controls = (selector) => [...document.querySelectorAll(selector)].filter(visible);
const enabled = (element) => element instanceof HTMLElement && !element.matches(':disabled, [aria-disabled="true"]');
const hasMedia = (editor) => !!editor.querySelector('img, video, audio, [contenteditable="false"]');

function waitFor(read, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const deadline = Date.now() + timeoutMs;
    const finish = (error, value = null) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new DOMException('已取消', 'AbortError'));
    const check = () => {
      if (signal.aborted) { abort(); return; }
      try {
        const result = read();
        if (result) { finish(null, result); return; }
        if (Date.now() >= deadline) { finish(new Error('等待 Grok 界面确认超时。')); return; }
        timer = setTimeout(check, 50);
      } catch (error) { finish(error); }
    };
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}

function currentModel() {
  const models = controls(MODEL);
  if (models.length !== 1 || !enabled(models[0])) throw new Error('无法唯一确认 Grok 模式按钮，已停止发送。');
  return /** @type {HTMLElement} */ (models[0]);
}
const isAuto = (model) => model.getAttribute('aria-label') === 'Select a model Auto' && text(model).trim() === 'Auto';

export async function handoffToGrok(prompt, signal, onSend = () => {}) {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (!onGrok()) {
    const nav = [...document.querySelectorAll('a[href="/i/grok"]')].find(visible);
    if (!(nav instanceof HTMLElement)) throw new Error('找不到 X 的 Grok 导航入口。');
    nav.click();
  }
  const editor = /** @type {HTMLElement} */ (await waitFor(() => {
    if (!onGrok()) return null;
    const editors = controls(COMPOSER);
    if (editors.length > 1) throw new Error('发现多个 Grok 输入框，已停止填写。');
    return editors[0] || null;
  }, signal, 8000));
  const route = location.href;
  const ready = () => location.href === route && onGrok() && editor.isConnected && visible(editor) && editor.matches(COMPOSER) && controls(COMPOSER).length === 1;
  const checkReady = () => {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    if (!ready()) throw new Error('Grok 输入框或页面已变化，已停止发送；请检查当前草稿。');
  };
  checkReady();
  // Preserve even whitespace and non-text drafts. Only an empty paragraph/BR is safe.
  const hasDraft = () => !!editor.textContent || hasMedia(editor);
  if (hasDraft()) throw new Error('Grok 已有草稿，已保留原文。');
  editor.focus();
  checkReady();
  if (document.activeElement !== editor || hasDraft()) throw new Error('无法安全填写 Grok 输入框，已有内容将保留。');
  const selection = window.getSelection();
  if (!selection) throw new Error('无法定位 Grok 输入光标。');
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  // One paste event only: Lexical's insertText handling drops line breaks.
  // DataTransfer is event-local; this does not read or write the system clipboard.
  const data = new DataTransfer();
  data.setData('text/plain', prompt);
  const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
  editor.dispatchEvent(paste);
  if (!paste.defaultPrevented) throw new Error('Grok 未接受粘贴操作。');
  const insertedAt = Date.now();
  await waitFor(() => {
    checkReady();
    return Date.now() - insertedAt >= 250 && text(editor) === prompt && !hasMedia(editor);
  }, signal, 2000);
  const checkPrompt = () => {
    checkReady();
    if (text(editor) !== prompt || hasMedia(editor)) throw new Error('Grok 提示词已变化，已停止发送。');
  };
  checkPrompt();
  const model = currentModel();
  if (!isAuto(model)) {
    if (!model.id) throw new Error('无法定位 Grok 模式菜单，已停止发送。');
    const autoOption = () => {
      if (currentModel() !== model) throw new Error('Grok 模式按钮已变化，已停止发送。');
      // Native Base UI links its menu to the trigger by aria-labelledby.
      // Compare ID tokens directly; never match Auto in an unrelated menu.
      const menus = controls('[role="menu"]').filter((menu) =>
        (menu.getAttribute('aria-labelledby') || '').split(/\s+/).includes(model.id));
      if (menus.length > 1) throw new Error('发现多个 Grok 模式菜单，已停止发送。');
      const options = menus.length === 1 ? [...menus[0].querySelectorAll('[role="menuitemradio"]')]
        .filter((option) => visible(option) && option.closest('[role="menu"]') === menus[0] && text(option).trim() === 'Auto') : [];
      if (options.length > 1) throw new Error('发现多个 Auto 选项，已停止发送。');
      return options.length === 1 && enabled(options[0]) && /^(true|false)$/.test(options[0].getAttribute('aria-checked') || '') ? options[0] : null;
    };
    model.click();
    const auto = /** @type {HTMLElement} */ (await waitFor(() => { checkPrompt(); return autoOption(); }, signal, 2000));
    checkPrompt();
    if (!auto.isConnected || autoOption() !== auto) throw new Error('Auto 选项已变化，已停止发送。');
    auto.click();
    await waitFor(() => {
      checkPrompt();
      // Native menus may unmount after selection; the trigger must show Auto.
      return isAuto(currentModel()) && (!auto.isConnected || !visible(auto) || auto.getAttribute('aria-checked') === 'true');
    }, signal, 2000);
  }
  // Acknowledgement needs a newly visible copy of the exact prompt in native
  // conversation content, outside our dialog and every editable field.
  const messages = () => controls('main div, main p').filter((element) =>
    !element.closest('.xps-fact-dialog, [contenteditable], [role="textbox"]') &&
    !element.querySelector(COMPOSER) && text(element) === prompt);
  const previousMessages = new Set(messages());
  const send = /** @type {HTMLButtonElement} */ (await waitFor(() => {
    checkPrompt();
    if (!isAuto(currentModel())) throw new Error('Grok Auto 模式未确认，已停止发送。');
    const sends = controls(SEND);
    if (sends.length > 1) throw new Error('发现多个发送按钮，已停止发送。');
    return sends.length === 1 && enabled(sends[0]) ? sends[0] : null;
  }, signal, 2000));
  const checkSend = () => {
    checkPrompt();
    if (!isAuto(currentModel())) throw new Error('Grok Auto 模式已变化，已停止发送。');
    const sends = controls(SEND);
    if (sends.length !== 1 || sends[0] !== send || !send.isConnected || !enabled(send)) throw new Error('发送按钮已变化，已停止发送。');
  };
  checkSend();
  onSend();
  checkSend(); // No await between this abort/route/editor/prompt/mode check and click.
  try {
    send.click(); // Never retry, even when the click throws or acknowledgement is lost.
    await waitFor(() => {
      if (!onGrok()) throw new Error('离开 Grok');
      const editors = controls(COMPOSER);
      return editors.length === 1 && !text(editors[0]) && !hasMedia(editors[0]) &&
        messages().some((message) => !previousMessages.has(message));
    }, signal, 8000);
  } catch {
    const error = new Error('已尝试发送，但无法确认发送结果。不会重试；请检查 Grok 会话，勿重复发送。');
    error.name = 'GrokSendOutcomeUnknown';
    throw error;
  }
  return /** @type {HTMLElement} */ (controls(COMPOSER)[0]);
}
