import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = buildSync({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', loader: { '.css': 'text' } }).outputFiles[0].text;
const bundle = readFileSync(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
let window;
afterEach(() => window?.close());
const post = (id = '123', content = '') => `<article tabindex="0"><a href="/person/status/${id}?s=20"><time></time></a>${content}</article>`;
const bar = '<div role="group"><button data-testid="reply"></button><button data-testid="like"></button></div>';
const shortcuts = [
  ...['w', 'W', 'v', 'V', 'c', 'C'].map((key) => ({ key, shiftKey: false })),
];

describe.each([['source', source], ['generated userscript', bundle]])('%s background shortcut', (_name, code) => {
  function setup(content = post()) {
    window = new JSDOM(content, { url: 'https://x.com/home', runScripts: 'outside-only' }).window;
    window.GM_openInTab = vi.fn(() => ({}));
    window.open = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.show = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    const storage = new Map();
    window.GM_getValue = (key) => storage.get(key);
    window.GM_setValue = (key, value) => storage.set(key, value);
    window.fetch = vi.fn(() => { throw new Error('Unexpected network request'); });
    window.XMLHttpRequest.prototype.send = vi.fn(() => { throw new Error('Unexpected network request'); });
    window.eval(code);
    const document = window.document;
    const key = (options = {}) => {
      const event = new window.KeyboardEvent('keydown', { key: 'w', shiftKey: false, bubbles: true, cancelable: true, ...options });
      document.activeElement.dispatchEvent(event);
      return event;
    };
    return { document, key, open: window.GM_openInTab, storage };
  }

  it('toggles the focused post through real Save clicks and persisted Saved state', async () => {
    const { document, key, storage, open } = setup(post('111', bar) + post('222', '<div data-testid="tweetText">Focused claim</div>' + bar));
    await vi.waitFor(() => expect(document.querySelectorAll('.xps-save-btn')).toHaveLength(2));
    const article = document.querySelectorAll('article')[1];
    const button = article.querySelector('.xps-save-btn');
    const clicked = vi.fn();
    const native = vi.fn();
    button.addEventListener('click', clicked);
    article.addEventListener('keydown', native);
    article.focus();
    expect(button.title).toContain('Save post locally');
    expect(button.title).toContain('v');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('v');
    expect(key({ key: 'v' }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(JSON.parse(storage.get('xSavedPosts'))).toMatchObject([{ id: '222', text: 'Focused claim' }]));
    expect(button.textContent).toBe('Saved');
    expect(button.title).toContain('Remove from local saves');
    expect(button.title).toContain('v');
    expect(key({ key: 'V' }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(JSON.parse(storage.get('xSavedPosts'))).toEqual([]));
    expect(button.textContent).toBe('Save');
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(native).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['c', 'C'])('checks the focused outer post via the existing local Grok fallback: %s', async (letter) => {
    const quote = '<div data-testid="embeddedTweet">' + post('999', '<div data-testid="tweetText">Quoted evidence</div><button>Quote focus</button>' + bar) + '</div>';
    const { document, key, storage } = setup(post('111', '<div data-testid="tweetText">Unfocused claim</div>' + bar) +
      post('222', '<div data-testid="tweetText">Focused claim</div>' + quote + bar));
    await vi.waitFor(() => expect(document.querySelectorAll('.xps-fact-btn')).toHaveLength(2));
    const button = document.querySelectorAll('.xps-fact-btn')[1];
    expect(button.title).toContain('自动');
    expect(button.title).toContain('c');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('c');
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    document.querySelector('[data-testid="embeddedTweet"] button').focus();
    expect(key({ key: letter }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(document.querySelector('dialog [role="status"]').textContent).toContain('请复制提示词'));
    const prompt = document.querySelector('dialog textarea').value;
    expect(prompt).toContain('https://x.com/person/status/222');
    expect(prompt).toContain('Focused claim');
    expect(prompt).toContain('Quoted evidence');
    expect(prompt).not.toContain('Unfocused claim');
    expect(clicked).toHaveBeenCalledOnce();
    expect(storage.has('xSavedPosts')).toBe(false);
    expect(window.fetch).not.toHaveBeenCalled();
    expect(window.XMLHttpRequest.prototype.send).not.toHaveBeenCalled();
    document.querySelector('dialog').dispatchEvent(new window.Event('cancel', { cancelable: true }));
    expect(document.querySelector('dialog')).toBeNull();
  });

  it.each(['v', 'c'])('uses the longform top-bar button, never a quoted button: %s', async (letter) => {
    const { document, key } = setup(post('123', '<div data-testid="embeddedTweet">' + post('999', bar) +
      '</div><article data-testid="twitterArticleReadView" tabindex="0"><a href="/person/status/123"></a><h1>Longform</h1>' + bar + '</article>'));
    await vi.waitFor(() => expect(document.querySelector('.xps-fact-btn')).not.toBeNull());
    const selector = letter === 'v' ? '.xps-save-btn' : '.xps-fact-btn';
    const top = document.querySelector('[data-testid="twitterArticleReadView"]');
    const clicked = vi.fn();
    top.querySelector(selector).addEventListener('click', clicked);
    const quoted = document.createElement('button');
    quoted.className = selector.slice(1);
    const quoteClick = vi.fn();
    quoted.addEventListener('click', quoteClick);
    document.querySelector('[data-testid="embeddedTweet"] article').append(quoted);
    top.focus();
    expect(key({ key: letter }).defaultPrevented).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
    expect(quoteClick).not.toHaveBeenCalled();
  });

  it.each(['v', 'c'])('does not capture missing, disabled, or quote-only actions: %s', async (letter) => {
    const { document, key } = setup(post('123', bar));
    await vi.waitFor(() => expect(document.querySelector('.xps-fact-btn')).not.toBeNull());
    const button = document.querySelector(letter === 'v' ? '.xps-save-btn' : '.xps-fact-btn');
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    document.querySelector('article').focus();
    button.disabled = true;
    expect(key({ key: letter }).defaultPrevented).toBe(false);
    button.disabled = false;
    button.setAttribute('aria-disabled', 'true');
    expect(key({ key: letter }).defaultPrevented).toBe(false);
    button.removeAttribute('aria-disabled');
    const quote = document.createElement('div');
    quote.dataset.testid = 'embeddedTweet';
    document.querySelector('article').append(quote);
    quote.append(button);
    expect(key({ key: letter }).defaultPrevented).toBe(false);
    button.remove();
    expect(key({ key: letter }).defaultPrevented).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('opens only the actually focused article, in capture phase without moving focus', () => {
    const { document, key, open } = setup(post('111') + post('222', '<button>Like</button>'));
    const article = document.querySelectorAll('article')[1];
    article.focus();
    const native = vi.fn();
    article.addEventListener('keydown', native);
    expect(key().defaultPrevented).toBe(true);
    expect(open).toHaveBeenLastCalledWith('https://x.com/person/status/222', { active: false, insert: true, setParent: true });
    expect(document.activeElement).toBe(article);
    expect(native).not.toHaveBeenCalled();
    article.querySelector('button').focus();
    key();
    expect(open).toHaveBeenCalledTimes(2);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('resolves a focused single-post cell and nested quote/read-view focus to the outer post', () => {
    const quote = '<div data-testid="embeddedTweet">' + post('999', '<button>Quote</button>') + '</div>';
    const { document, key, open } = setup(`<div data-testid="cellInnerDiv" tabindex="0">${post('123', quote + '<article data-testid="twitterArticleReadView" tabindex="0"></article>')}</div>`);
    document.querySelector('[data-testid="cellInnerDiv"]').focus();
    key();
    document.querySelector('button').focus();
    key();
    document.querySelector('[data-testid="twitterArticleReadView"]').focus();
    key();
    expect(open.mock.calls.map(([url]) => url)).toEqual(Array(3).fill('https://x.com/person/status/123'));
  });

  it('never chooses embedded, media, external, or text links instead of the own permalink', () => {
    const { document, key, open } = setup(`<article tabindex="0">
      <div data-testid="embeddedTweet"><a href="/quote/status/999"><time></time></a></div>
      <article><a href="/nested/status/888"><time></time></a></article>
      <a href="https://example.com/person/status/777"><time></time></a>
      <a href="/person/status/666/photo/1"><time></time></a>
      <div data-testid="card.wrapper"><a href="/card/status/555"></a></div>
      <div data-testid="tweetText"><a href="/text/status/444"></a></div>
      <a id="own" href="https://twitter.com/person/status/123?s=20">Date</a>
    </article>`);
    document.querySelector('article').focus();
    key();
    expect(open).toHaveBeenCalledWith('https://x.com/person/status/123', expect.any(Object));
    document.querySelector('#own').remove();
    expect(key().defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { keyCode: 229 }, { repeat: true }, { key: 'Process' },
    { key: 'j' }, { key: 'k' }, { key: 'Escape' },
    { key: 'Enter', shiftKey: false }, { key: 'Enter', shiftKey: true }, { key: 'x' }, { key: 'X' }, { key: 's' }, { key: 'f' }, { key: 'o' }, { key: 'b' }, { key: '/' }, { key: '?' },
  ])('leaves other keys/modifiers untouched for all shortcuts: %j', async (options) => {
    const { document, key, open } = setup(post('123', bar));
    await vi.waitFor(() => expect(document.querySelector('.xps-fact-btn')).not.toBeNull());
    const clicked = vi.fn();
    document.querySelectorAll('.xps-save-btn, .xps-fact-btn').forEach((button) => button.addEventListener('click', clicked));
    document.querySelector('article').focus();
    for (const shortcut of shortcuts) {
      expect(key({ ...shortcut, ...options }).defaultPrevented).toBe(false);
    }
    expect(clicked).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    '<input>', '<textarea></textarea>', '<select><option>Choice</option></select>',
    '<div contenteditable="true"><span tabindex="0">Draft</span></div>',
    '<div contenteditable=""><span tabindex="0">Draft</span></div>',
    '<div role="textbox"><span tabindex="0">Draft</span></div>',
    '<div role="dialog"><button>Dialog</button></div>',
  ])('ignores editor descendants and unrelated dialogs for all shortcuts: %s', async (content) => {
    const { document, key, open } = setup(post('123', content + bar));
    await vi.waitFor(() => expect(document.querySelector('.xps-fact-btn')).not.toBeNull());
    const clicked = vi.fn();
    document.querySelectorAll('.xps-save-btn, .xps-fact-btn').forEach((button) => button.addEventListener('click', clicked));
    document.querySelector('input, textarea, select, span, button').focus();
    for (const shortcut of shortcuts) expect(key(shortcut).defaultPrevented).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('does not infer focus from hover, visibility, or an ambiguous cell', async () => {
    const { document, key, open } = setup(`<div tabindex="0" data-testid="cellInnerDiv">${post('111', bar)}${post('222', bar)}</div><button id="outside">Outside</button>`);
    await vi.waitFor(() => expect(document.querySelectorAll('.xps-fact-btn')).toHaveLength(2));
    const clicked = vi.fn();
    document.querySelectorAll('.xps-save-btn, .xps-fact-btn').forEach((button) => button.addEventListener('click', clicked));
    document.querySelector('article').dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    for (const shortcut of shortcuts) expect(key(shortcut).defaultPrevented).toBe(false);
    document.querySelector('#outside').focus();
    for (const shortcut of shortcuts) expect(key(shortcut).defaultPrevented).toBe(false);
    document.querySelector('[data-testid="cellInnerDiv"]').focus();
    for (const shortcut of shortcuts) expect(key(shortcut).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(clicked).not.toHaveBeenCalled();
  });

  it.each([
    ['<article tabindex="0"></article>', null],
    ['<article tabindex="0"><a href="/one/status/111"></a><a href="/two/status/222"></a></article>', null],
    ['<article tabindex="0"><a href="/i/web/status/123">Date</a></article>', 'https://x.com/i/web/status/123'],
    ['<article tabindex="0"><a href="/status/123">Date</a></article>', 'https://x.com/status/123'],
    ...['data-testid="testCondensedMedia"', 'data-testid="embeddedTweet"', 'aria-label="Embedded Tweet"', 'aria-label="Embedded Post"', 'aria-label="Embedded post"']
      .map((attribute) => [`<article tabindex="0"><div ${attribute}><a href="/quote/status/999"><time></time></a></div></article>`, null]),
  ])('opens only unambiguous owned status URLs: %s', (content, expected) => {
    const { document, key, open } = setup(content);
    document.querySelector('article').focus();
    expect(key().defaultPrevented).toBe(expected !== null);
    if (expected) expect(open).toHaveBeenCalledWith(expected, expect.any(Object));
    else expect(open).not.toHaveBeenCalled();
  });

  it('shows a useful missing-API error without intercepting the key when unavailable', () => {
    const { document, key, open } = setup();
    delete window.GM_openInTab;
    document.querySelector('article').focus();
    expect(key().defaultPrevented).toBe(false);
    expect(document.querySelector('#xps-toast').textContent).toContain('GM_openInTab');
    expect(open).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject', 'null', 'false'])('shows opening failure without a window.open fallback: %s', async (failure) => {
    const { document, key, open } = setup();
    open.mockImplementation(() => {
      if (failure === 'throw') throw new Error('Denied');
      if (failure === 'reject') return Promise.reject(new Error('Denied'));
      return failure === 'null' ? null : false;
    });
    document.querySelector('article').focus();
    expect(key().defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(document.querySelector('#xps-toast')?.textContent).toContain('tab permission'));
    expect(window.open).not.toHaveBeenCalled();
  });
});
