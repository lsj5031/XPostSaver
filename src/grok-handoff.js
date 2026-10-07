// @ts-check
// Verified against X's logged-in native UI; no service endpoints or submit controls.
const COMPOSER = '[data-lexical-editor="true"][contenteditable="true"][role="textbox"]';
const onGrok = () => /^\/i\/grok(?:\/|$)/.test(location.pathname);
const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
const text = (editor) => (editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n');

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
        if (Date.now() >= deadline) { finish(new Error('等待 Grok 输入框超时。')); return; }
        timer = setTimeout(check, 50);
      } catch (error) { finish(error); }
    };
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}

export async function handoffToGrok(prompt, signal) {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (!onGrok()) {
    const nav = [...document.querySelectorAll('a[href="/i/grok"]')].find(visible);
    if (!(nav instanceof HTMLElement)) throw new Error('找不到 X 的 Grok 导航入口。');
    nav.click();
  }
  const editor = /** @type {HTMLElement} */ (await waitFor(() => {
    if (!onGrok()) return null;
    const editors = [...document.querySelectorAll(COMPOSER)].filter(visible);
    if (editors.length > 1) throw new Error('发现多个 Grok 输入框，已停止填写。');
    return editors[0] || null;
  }, signal, 8000));
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const ready = () => onGrok() && editor.isConnected && visible(editor) && editor.matches(COMPOSER);
  if (!ready()) throw new Error('Grok 输入框已变化。');
  // Preserve even whitespace and non-text drafts. Only an empty paragraph/BR is safe.
  const hasDraft = () => !!editor.textContent || !!editor.querySelector('img, video, audio, [contenteditable="false"]');
  if (hasDraft()) throw new Error('Grok 已有草稿，已保留原文。');
  editor.focus();
  if (!ready() || document.activeElement !== editor || hasDraft()) throw new Error('无法安全填写 Grok 输入框，已有内容将保留。');
  const selection = window.getSelection();
  if (!selection) throw new Error('无法定位 Grok 输入光标。');
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  // One native edit only. Lexical commits asynchronously; do not mutate its DOM.
  if (!document.execCommand('insertText', false, prompt)) throw new Error('浏览器未接受填写操作。');
  const insertedAt = Date.now();
  await waitFor(() => {
    if (!ready()) throw new Error('Grok 输入框已变化；请检查当前草稿。');
    // Allow Lexical to settle before reporting success, without repeating the edit.
    return Date.now() - insertedAt >= 250 && text(editor) === prompt;
  }, signal, 2000);
  return editor;
}
