// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { handoffToGrok } from '../src/grok-handoff.js';

let controller;
let send;
function composer(value = '') {
  const editor = document.createElement('div');
  editor.dataset.lexicalEditor = 'true';
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('role', 'textbox');
  editor.tabIndex = 0;
  editor.textContent = value;
  document.body.append(editor);
  return editor;
}
beforeEach(() => {
  vi.useFakeTimers();
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
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('navigates with the native link once and verifies asynchronous insertion without sending', async () => {
  history.replaceState(null, '', '/person/status/123');
  const nav = document.createElement('a'); nav.href = '/i/grok';
  const navigate = vi.fn((event) => {
    event.preventDefault();
    history.replaceState(null, '', '/i/grok');
    setTimeout(() => composer(), 100);
  });
  nav.addEventListener('click', navigate); document.body.append(nav);
  document.execCommand = vi.fn((command, _, prompt) => {
    const editor = document.activeElement;
    setTimeout(() => { editor.textContent = prompt; }, 100);
    return true;
  });
  const done = handoffToGrok('中文核查\n来源 URL：https://x.com/a/status/123', controller.signal);
  let settled = false; done.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(200);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  const editor = await done;
  expect(editor.textContent).toContain('中文核查');
  expect(document.execCommand).toHaveBeenCalledTimes(1);
  expect(document.execCommand.mock.calls[0][0]).toBe('insertText');
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(send.click).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['Existing draft', ' ', '\n'])('preserves nonempty draft %j', async (draft) => {
  const editor = composer(draft);
  await expect(handoffToGrok('new prompt', controller.signal)).rejects.toThrow('已有草稿');
  expect(editor.textContent).toBe(draft);
  expect(document.execCommand).not.toHaveBeenCalled();
});

it('preserves non-text draft content', async () => {
  const editor = composer(); editor.append(document.createElement('img'));
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('已有草稿');
  expect(document.execCommand).not.toHaveBeenCalled();
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
  expect(document.execCommand).toHaveBeenCalledTimes(1);
  expect(send.click).not.toHaveBeenCalled();
});

it('stops when the editor is replaced or the user navigates away after insertion', async () => {
  const editor = composer();
  document.execCommand = vi.fn(() => { editor.remove(); return true; });
  await expect(handoffToGrok('new', controller.signal)).rejects.toThrow('已变化');
  expect(document.execCommand).toHaveBeenCalledTimes(1);
});
