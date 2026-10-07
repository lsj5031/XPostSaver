// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { handoffToGrok } from '../src/grok-handoff.js';

let controller;
let send;
let pasteHandler;
let model;

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
  model = document.createElement('button');
  model.id = 'base-ui-_r_e_';
  model.setAttribute('aria-label', 'Select a model Auto');
  model.textContent = 'Auto';
  document.body.append(model);
  vi.spyOn(model, 'click');
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('navigates once, preserves exact multiline paste, and sends once in verified Auto mode', async () => {
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
  let sentText;
  send.addEventListener('click', () => {
    const editor = document.querySelector('[data-lexical-editor]');
    sentText = editor.innerText;
    expect(editor.querySelectorAll('br')).toHaveLength(prompt.split('\n').length - 1);
    acknowledge(editor, prompt);
  });
  let settled = false; done.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(200);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  const editor = await done;
  expect(sentText).toBe(prompt);
  expect(editor.innerText).toBe('');
  expect(model.click).not.toHaveBeenCalled();
  expect(pasteHandler).toHaveBeenCalledTimes(1);
  expect(pasteHandler.mock.calls[0][0].defaultPrevented).toBe(true);
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(send.click).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['Existing draft', ' ', '\n'])('preserves nonempty draft %j', async (draft) => {
  const editor = composer(draft);
  await expect(handoffToGrok('new prompt', controller.signal)).rejects.toThrow('已有草稿');
  expect(editor.textContent).toBe(draft);
  expect(send.click).not.toHaveBeenCalled();
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(pasteHandler).not.toHaveBeenCalled();
});

it('preserves non-text draft content', async () => {
  const editor = composer(); editor.append(document.createElement('img'));
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('已有草稿');
  expect(send.click).not.toHaveBeenCalled();
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

function acknowledge(editor, prompt) {
  commitPaste(editor, '');
  const main = document.querySelector('main') || document.body.appendChild(document.createElement('main'));
  const message = document.createElement('div');
  message.textContent = prompt;
  main.append(message);
}
function readyPaste() {
  const editor = composer();
  pasteHandler = vi.fn((event) => {
    event.preventDefault();
    commitPaste(editor, event.clipboardData.getData('text/plain'));
  });
  return editor;
}
function expertMenu(select = () => {
  model.setAttribute('aria-label', 'Select a model Auto');
  model.textContent = 'Auto';
}) {
  model.setAttribute('aria-label', 'Select a model Expert');
  model.textContent = 'Expert';
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-labelledby', model.id);
  const auto = document.createElement('button'); auto.setAttribute('role', 'menuitemradio'); auto.textContent = 'Auto';
  auto.setAttribute('aria-checked', 'false');
  menu.append(auto);
  model.addEventListener('click', () => { document.body.append(menu); });
  auto.addEventListener('click', () => { auto.setAttribute('aria-checked', 'true'); select(); });
  vi.spyOn(auto, 'click');
  return auto;
}

it('selects Auto exactly once from Expert and verifies it before Send', async () => {
  const editor = readyPaste();
  const auto = expertMenu();
  send.addEventListener('click', () => {
    expect(model.getAttribute('aria-label')).toBe('Select a model Auto');
    acknowledge(editor, '中文\n\n核查');
  });
  const onSend = vi.fn();
  const done = handoffToGrok('中文\n\n核查', controller.signal, onSend);
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(model.click).toHaveBeenCalledTimes(1);
  expect(auto.click).toHaveBeenCalledTimes(1);
  expect(send.click).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledTimes(1);
});

it.each(['missing', 'ambiguous', 'disabled', 'unchanged', 'label mismatch'])('never sends on %s Auto mode', async (failure) => {
  readyPaste();
  if (failure === 'missing') model.remove();
  if (failure === 'ambiguous') document.body.append(model.cloneNode(true));
  if (failure === 'disabled') model.disabled = true;
  if (failure === 'unchanged') expertMenu(() => {});
  if (failure === 'label mismatch') model.textContent = 'Expert';
  const done = expect(handoffToGrok('prompt', controller.signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000); await done;
  expect(send.click).not.toHaveBeenCalled();
  expect(pasteHandler).toHaveBeenCalledTimes(1);
});

it.each(['missing', 'ambiguous', 'disabled', 'hidden', 'aria-hidden', 'inert', 'aria-disabled'])('never sends with %s Send control', async (failure) => {
  readyPaste();
  if (failure === 'missing') send.remove();
  if (failure === 'ambiguous') document.body.append(send.cloneNode(true));
  if (failure === 'disabled') send.disabled = true;
  if (failure === 'hidden') send.style.visibility = 'hidden';
  if (failure === 'aria-disabled') send.setAttribute('aria-disabled', 'true');
  if (failure === 'aria-hidden') send.setAttribute('aria-hidden', 'true');
  if (failure === 'inert') send.setAttribute('inert', '');
  const done = expect(handoffToGrok('prompt', controller.signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(3000); await done;
  expect(send.click).not.toHaveBeenCalled();
});

it.each(['cancel', 'navigate', 'replace', 'prompt', 'mode', 'send', 'media'])('rechecks %s immediately before the single click', async (change) => {
  const editor = readyPaste();
  const onSend = () => {
    if (change === 'cancel') controller.abort();
    if (change === 'navigate') history.replaceState(null, '', '/i/grok/other');
    if (change === 'replace') { editor.remove(); composer(); }
    if (change === 'prompt') commitPaste(editor, 'Changed');
    if (change === 'mode') model.setAttribute('aria-label', 'Select a model Expert');
    if (change === 'send') { send.remove(); document.body.append(send.cloneNode(true)); }
    if (change === 'media') editor.append(document.createElement('img'));
  };
  const done = expect(handoffToGrok('prompt', controller.signal, onSend)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(send.click).not.toHaveBeenCalled();
});

it('cancels while selecting Auto without sending', async () => {
  readyPaste(); expertMenu(() => controller.abort());
  const done = expect(handoffToGrok('prompt', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(send.click).not.toHaveBeenCalled();
});

it.each(['timeout', 'clear only', 'message only', 'old message', 'cancel', 'navigate', 'throw'])('reports unknown outcome after %s and never retries', async (outcome) => {
  const editor = readyPaste();
  if (outcome === 'old message') {
    acknowledge(editor, 'prompt');
    commitPaste(editor, '');
  }
  send.addEventListener('click', () => {
    if (outcome === 'clear only' || outcome === 'old message') commitPaste(editor, '');
    if (outcome === 'message only') { acknowledge(editor, 'prompt'); commitPaste(editor, 'prompt'); }
    if (outcome === 'cancel') controller.abort();
    if (outcome === 'navigate') history.replaceState(null, '', '/home');
  });
  if (outcome === 'throw') send.click.mockImplementation(() => { throw new Error('dispatch failed'); });
  const done = expect(handoffToGrok('prompt', controller.signal)).rejects.toMatchObject({ name: 'GrokSendOutcomeUnknown', message: expect.stringContaining('勿重复发送') });
  await vi.advanceTimersByTimeAsync(9000); await done;
  await vi.advanceTimersByTimeAsync(9000);
  expect(send.click).toHaveBeenCalledTimes(1);
  expect(pasteHandler).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('waits for acknowledgement instead of treating a click as success', async () => {
  const editor = readyPaste();
  send.addEventListener('click', () => setTimeout(() => acknowledge(editor, 'prompt'), 500));
  let settled = false;
  const done = handoffToGrok('prompt', controller.signal).then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(300);
  expect(send.click).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(settled).toBe(true);
  expect(send.click).toHaveBeenCalledTimes(1);
});


it.each(['missing', 'ambiguous', 'disabled'])('does not select or send with an %s Auto menu option', async (failure) => {
  readyPaste();
  const auto = expertMenu();
  if (failure === 'missing') auto.remove();
  if (failure === 'ambiguous') auto.parentElement.append(auto.cloneNode(true));
  if (failure === 'disabled') auto.disabled = true;
  const done = expect(handoffToGrok('prompt', controller.signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(3000); await done;
  expect(auto.click).not.toHaveBeenCalled();
  expect(send.click).not.toHaveBeenCalled();
});


it('ignores Auto radio items in unrelated menus', async () => {
  const editor = readyPaste();
  const auto = expertMenu();
  const unrelatedMenu = auto.parentElement.cloneNode(true);
  unrelatedMenu.setAttribute('aria-labelledby', 'unrelated-button');
  document.body.append(unrelatedMenu);
  const unrelated = unrelatedMenu.querySelector('[role="menuitemradio"]');
  vi.spyOn(unrelated, 'click');
  send.addEventListener('click', () => acknowledge(editor, 'prompt'));
  const done = handoffToGrok('prompt', controller.signal);
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(auto.click).toHaveBeenCalledTimes(1);
  expect(unrelated.click).not.toHaveBeenCalled();
  expect(send.click).toHaveBeenCalledTimes(1);
});

it.each(['missing trigger ID', 'unlinked menu', 'ambiguous menus', 'missing checked state', 'unchecked after click'])('stops without Send for %s', async (failure) => {
  readyPaste();
  const auto = expertMenu();
  const menu = auto.parentElement;
  if (failure === 'missing trigger ID') model.removeAttribute('id');
  if (failure === 'unlinked menu') menu.setAttribute('aria-labelledby', 'unrelated-button');
  if (failure === 'ambiguous menus') document.body.append(menu.cloneNode(true));
  if (failure === 'missing checked state') auto.removeAttribute('aria-checked');
  if (failure === 'unchecked after click') auto.addEventListener('click', () => auto.setAttribute('aria-checked', 'false'));
  const done = expect(handoffToGrok('prompt', controller.signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(3000); await done;
  expect(send.click).not.toHaveBeenCalled();
  expect(auto.click).toHaveBeenCalledTimes(failure === 'unchecked after click' ? 1 : 0);
});

it('verifies the updated Auto trigger when the native menu unmounts after selection', async () => {
  const editor = readyPaste();
  const auto = expertMenu();
  auto.addEventListener('click', () => auto.parentElement.remove());
  send.addEventListener('click', () => acknowledge(editor, 'prompt'));
  const done = handoffToGrok('prompt', controller.signal);
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(auto.click).toHaveBeenCalledTimes(1);
  expect(send.click).toHaveBeenCalledTimes(1);
});


function scopedComposer(editor) {
  const container = document.createElement('div');
  const middle = document.createElement('div');
  const inner = document.createElement('div');
  inner.append(editor); middle.append(inner); container.append(middle, model, send);
  document.body.append(container);
  return container;
}

it('uses the nearest editor ancestor controls and ignores unrelated native controls', async () => {
  const editor = readyPaste();
  scopedComposer(editor);
  const unrelatedSend = send.cloneNode(true);
  const unrelatedModel = model.cloneNode(true); unrelatedModel.id = 'unrelated-model';
  document.body.append(unrelatedSend, unrelatedModel);
  vi.spyOn(unrelatedSend, 'click'); vi.spyOn(unrelatedModel, 'click');
  const auto = expertMenu();
  send.addEventListener('click', () => acknowledge(editor, 'prompt'));
  const done = handoffToGrok('prompt', controller.signal);
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(auto.click).toHaveBeenCalledTimes(1);
  expect(send.click).toHaveBeenCalledTimes(1);
  expect(unrelatedSend.click).not.toHaveBeenCalled();
  expect(unrelatedModel.click).not.toHaveBeenCalled();
});

it.each(['editor', 'model', 'send'])('stops if the %s moves outside the verified editor container before Send', async (target) => {
  const editor = readyPaste(); scopedComposer(editor);
  const onSend = () => document.body.append({ editor, model, send }[target]);
  const done = expect(handoffToGrok('prompt', controller.signal, onSend)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(500); await done;
  expect(send.click).not.toHaveBeenCalled();
});

it('waits boundedly for the mode button to become enabled', async () => {
  const editor = readyPaste(); scopedComposer(editor);
  model.disabled = true;
  setTimeout(() => { model.disabled = false; }, 500);
  send.addEventListener('click', () => acknowledge(editor, 'prompt'));
  const done = handoffToGrok('prompt', controller.signal);
  await vi.advanceTimersByTimeAsync(300);
  expect(send.click).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300); await done;
  expect(send.click).toHaveBeenCalledTimes(1);
});
