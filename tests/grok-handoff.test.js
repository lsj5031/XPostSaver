// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { handoffToGrok } from '../src/grok-handoff.js';

let controller;
let send;
let pasteHandler;

// jsdom has no DataTransfer/ClipboardEvent. Model only the public event contract;
// editor listeners below model Lexical's asynchronous commit, including BR nodes.
class TestDataTransfer {
  data = new Map();
  setData(type, value) { this.data.set(type, value); }
  getData(type) { return this.data.get(type) || ''; }
}
class TestClipboardEvent extends Event {
  constructor(type, options) {
    super(type, options);
    this.clipboardData = options.clipboardData;
  }
}
function commitPaste(editor, value) {
  const paragraph = document.createElement('p');
  value.split('\n').forEach((line, index) => {
    if (index) paragraph.append(document.createElement('br'));
    const span = document.createElement('span');
    span.dataset.lexicalText = 'true';
    span.textContent = line;
    paragraph.append(span);
  });
  editor.replaceChildren(paragraph);
  // jsdom lacks rendered innerText; derive it from the DOM's actual line breaks.
  Object.defineProperty(editor, 'innerText', { configurable: true, get() {
    return [...paragraph.childNodes].map((node) => node.nodeName === 'BR' ? '\n' : node.textContent).join('');
  } });
}
function composer(value = '') {
  const editor = document.createElement('div');
  editor.dataset.lexicalEditor = 'true';
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('role', 'textbox');
  editor.tabIndex = 0;
  editor.textContent = value;
  editor.addEventListener('paste', (event) => pasteHandler(event));
  document.body.append(editor);
  return editor;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('DataTransfer', TestDataTransfer);
  vi.stubGlobal('ClipboardEvent', TestClipboardEvent);
  pasteHandler = vi.fn((event) => { event.preventDefault(); });
  controller = new AbortController();
  history.replaceState(null, '', '/i/grok');
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 200, height: 100 }]);
  send = document.createElement('button');
  send.setAttribute('aria-label', 'Send');
  send.addEventListener('click', vi.fn());
  document.body.append(send);
  vi.spyOn(send, 'click');
  document.execCommand = vi.fn(() => true);
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('navigates once and preserves exact multiline text through asynchronous native paste without sending', async () => {
  history.replaceState(null, '', '/person/status/123');
  const nav = document.createElement('a'); nav.href = '/i/grok';
  const navigate = vi.fn((event) => {
    event.preventDefault();
    history.replaceState(null, '', '/i/grok');
    setTimeout(() => composer(), 100);
  });
  nav.addEventListener('click', navigate); document.body.append(nav);
  pasteHandler = vi.fn((event) => {
    event.preventDefault();
    const editor = event.currentTarget;
    const prompt = event.clipboardData.getData('text/plain');
    setTimeout(() => { commitPaste(editor, prompt); }, 100);
  });
  const prompt = '中文核查\n\n来源 URL：\nhttps://x.com/a/status/123\n\n帖子正文：\n第一行\n第二行\n\n引用上下文：\n引用正文';
  const done = handoffToGrok(prompt, controller.signal);
  let settled = false; done.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(200);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  const editor = await done;
  expect(editor.innerText).toBe(prompt);
  expect(editor.querySelectorAll('br')).toHaveLength(prompt.split('\n').length - 1);
  expect(pasteHandler).toHaveBeenCalledTimes(1);
  expect(pasteHandler.mock.calls[0][0].defaultPrevented).toBe(true);
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(send.click).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['Existing draft', ' ', '\n'])('preserves nonempty draft %j', async (draft) => {
  const editor = composer(draft);
  await expect(handoffToGrok('new prompt', controller.signal)).rejects.toThrow('已有草稿');
  expect(editor.textContent).toBe(draft);
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(pasteHandler).not.toHaveBeenCalled();
});

it('preserves non-text draft content', async () => {
  const editor = composer(); editor.append(document.createElement('img'));
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('已有草稿');
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(pasteHandler).not.toHaveBeenCalled();
});

it('rechecks drafts after focus handlers run', async () => {
  const editor = composer();
  editor.addEventListener('focus', () => { editor.textContent = 'Restored draft'; });
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('安全填写');
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(editor.textContent).toBe('Restored draft');
});

it('times out without insertion when no visible composer arrives', async () => {
  const editor = composer(); editor.style.visibility = 'hidden';
  const done = expect(handoffToGrok('new', controller.signal)).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(8000); await done;
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not insert into a different route or ambiguous editors', async () => {
  composer(); composer();
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('多个');
  history.replaceState(null, '', '/home');
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('导航入口');
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(pasteHandler).not.toHaveBeenCalled();
});

it('cancels bounded waiting and leaves late composers untouched', async () => {
  const done = expect(handoffToGrok('new', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await done;
  composer(); await vi.advanceTimersByTimeAsync(9000);
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not retry an edit that Lexical fails to retain', async () => {
  composer();
  const done = expect(handoffToGrok('new', controller.signal)).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(2100); await done;
  expect(pasteHandler).toHaveBeenCalledTimes(1);
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(send.click).not.toHaveBeenCalled();
});

it('stops when the editor is replaced or the user navigates away after insertion', async () => {
  const editor = composer();
  pasteHandler = vi.fn((event) => { event.preventDefault(); editor.remove(); });
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('已变化');
  expect(pasteHandler).toHaveBeenCalledTimes(1);
  expect(document.execCommand).not.toHaveBeenCalled();
});

it('rejects altered multiline content even when the paste event was consumed', async () => {
  const editor = composer();
  const prompt = '请用简体中文核查。\n\n来源 URL：\nhttps://x.com/a/status/123\n\n帖子正文：\n第一行\n第二行\n\n引用上下文：\n引用正文';
  pasteHandler = vi.fn((event) => {
    event.preventDefault();
    const value = event.clipboardData.getData('text/plain');
    // Keep the exact-text guard: an acknowledged edit is not proof of intact content.
    setTimeout(() => { commitPaste(editor, value.replace(/\n/g, '')); }, 50);
  });
  const done = expect(handoffToGrok(prompt, controller.signal)).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(2100);
  await done;
  expect(editor.textContent).toBe(prompt.replace(/\n/g, ''));
  expect(pasteHandler).toHaveBeenCalledTimes(1);
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(send.click).not.toHaveBeenCalled();
});


it('falls back immediately when the paste event is not consumed, without a second edit', async () => {
  const editor = composer();
  pasteHandler = vi.fn();
  await expect(handoffToGrok('中文\n\n核查', controller.signal)).rejects.toThrow('未接受粘贴');
  await vi.advanceTimersByTimeAsync(0); // Flush jsdom selectionchange notifications.
  expect(editor.textContent).toBe('');
  expect(pasteHandler).toHaveBeenCalledTimes(1);
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(send.click).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('falls back without editing when the browser does not support event-local paste data', async () => {
  composer();
  vi.stubGlobal('DataTransfer', undefined);
  await expect(handoffToGrok('中文\n核查', controller.signal)).rejects.toThrow();
  expect(pasteHandler).not.toHaveBeenCalled();
  expect(document.execCommand).not.toHaveBeenCalled();
});
