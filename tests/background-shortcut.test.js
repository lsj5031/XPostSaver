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

  it('pages smoothly after a button click, supports reverse paging, and consumes held Space', () => {
    const { document, key } = setup(post('123', bar));
    window.scrollBy = vi.fn();
    const button = document.querySelector('button');
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    button.focus();
    button.click();
    const native = vi.fn();
    button.addEventListener('keydown', native);
    expect(key({ key: ' ' }).defaultPrevented).toBe(true);
    expect(window.scrollBy).toHaveBeenLastCalledWith({ top: window.innerHeight, left: 0, behavior: 'smooth' });
    expect(key({ key: ' ', repeat: true }).defaultPrevented).toBe(true);
    expect(window.scrollBy).toHaveBeenCalledTimes(1);
    key({ key: ' ', shiftKey: true });
    expect(window.scrollBy).toHaveBeenLastCalledWith({ top: -window.innerHeight, left: 0, behavior: 'smooth' });
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it('pages without a focused post and respects reduced motion', () => {
    const { key } = setup('<main>Timeline</main>');
    window.scrollBy = vi.fn();
    window.matchMedia = vi.fn(() => ({ matches: true }));
    expect(key({ key: ' ' }).defaultPrevented).toBe(true);
    expect(window.scrollBy).toHaveBeenCalledWith({ top: window.innerHeight, left: 0, behavior: 'instant' });
  });

  function navigation(content = post('111', bar) + post('222', bar) + post('333', bar)) {
    const harness = setup(`<main data-testid="primaryColumn"><header style="position:sticky"></header>${content}</main>`);
    const rect = (top, bottom, left = 0, right = 600) => ({
      top, bottom, left, right, width: right - left, height: bottom - top,
    });
    const { document } = harness;
    document.querySelector('main').getBoundingClientRect = () => rect(0, 768);
    document.querySelector('header').getBoundingClientRect = () => rect(0, 80);
    const articles = [...document.querySelectorAll('article')];
    const bounds = articles.map((_, i) => rect(i * 240 + 80, i * 240 + 320));
    articles.forEach((article, i) => { article.getBoundingClientRect = () => bounds[i]; });
    window.scrollBy = vi.fn();
    return { ...harness, articles, bounds, rect };
  }

  it.each(['manual', 'Space'])('reanchors stale upper focus after %s scrolling, then traverses both ways', (scroll) => {
    const { document, key, articles, bounds, rect } = navigation();
    articles[0].focus();
    if (scroll === 'Space') key({ key: ' ' });
    bounds[0] = rect(-300, 80); // Entirely behind the sticky header.
    bounds[1] = rect(80, 320);
    bounds[2] = rect(320, 560);
    const native = vi.fn();
    document.addEventListener('keydown', native);
    window.scrollBy.mockClear();
    expect(key({ key: 'j' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(articles[1]);
    key({ key: 'j' });
    expect(document.activeElement).toBe(articles[2]);
    key({ key: 'k' });
    expect(document.activeElement).toBe(articles[1]);
    articles[0].focus({ preventScroll: true });
    key({ key: 'k' });
    expect(document.activeElement).toBe(articles[2]);
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it('accepts tall intersecting posts, reveals offscreen successors, and owns boundaries/repeats', () => {
    const { document, key, articles, bounds, rect } = navigation();
    bounds[0] = rect(-600, 1000);
    bounds[1] = rect(1000, 1240);
    bounds[2] = rect(1240, 1480);
    key({ key: 'j' });
    expect(document.activeElement).toBe(articles[0]);
    expect(key({ key: 'k' }).defaultPrevented).toBe(true);
    expect(key({ key: 'j', repeat: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(articles[0]);
    key({ key: 'j' });
    expect(document.activeElement).toBe(articles[1]);
    expect(window.scrollBy).toHaveBeenLastCalledWith({ top: 920, left: 0, behavior: 'instant' });
    bounds[1] = rect(80, 320);
    bounds[2] = rect(320, 560);
    key({ key: 'j' });
    expect(key({ key: 'j' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(articles[2]);
  });

  it('derives fresh nodes, excludes quotes/read views, hidden and horizontal/sidebar/other timelines', () => {
    const { document, key, articles, bounds, rect } = navigation();
    articles[0].insertAdjacentHTML('beforeend', `<div data-testid="embeddedTweet">${post('999')}</div><article data-testid="twitterArticleReadView" tabindex="0"></article>`);
    document.querySelector('main').insertAdjacentHTML('beforeend', `<aside>${post('888')}</aside>`);
    document.querySelectorAll('article article, aside article').forEach((article) => {
      article.getBoundingClientRect = () => rect(80, 320);
    });
    bounds[0] = rect(-300, -60);
    bounds[1] = rect(80, 320, 1200, 1800);
    articles[2].hidden = true;
    expect(key({ key: 'j' }).defaultPrevented).toBe(false);
    articles[2].hidden = false;
    articles[0].focus();
    articles[0].remove();
    key({ key: 'j' });
    expect(document.activeElement).toBe(articles[2]);
    const replacement = articles[2].cloneNode(true);
    replacement.removeAttribute('tabindex');
    replacement.getBoundingClientRect = () => rect(80, 320);
    articles[2].replaceWith(replacement);
    key({ key: 'k' });
    expect(document.activeElement).toBe(replacement);
    expect(replacement.tabIndex).toBe(-1);
    replacement.querySelector('a').remove();
    expect(key({ key: 'j' }).defaultPrevented).toBe(false);
  });

  it('limits navigation to the identifiable primary timeline region', () => {
    const { document, key, articles } = navigation();
    const region = document.createElement('section');
    region.setAttribute('aria-label', 'Timeline: Home');
    articles[1].before(region);
    region.append(articles[1]);
    document.body.insertAdjacentHTML('beforeend', `<div data-testid="sidebarColumn">${post('999')}</div>`);
    document.querySelector('[data-testid="sidebarColumn"] article').getBoundingClientRect = articles[1].getBoundingClientRect;
    key({ key: 'j' });
    expect(document.activeElement).toBe(articles[1]);
    key({ key: 'j' });
    expect(document.activeElement).toBe(articles[1]);
  });

  it.each([
    { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { keyCode: 229 }, { key: 'J' }, { key: 'x' },
  ])('preserves native navigation combinations/composition: %j', (options) => {
    const { document, key } = navigation();
    const focused = document.activeElement;
    expect(key({ key: 'j', ...options }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(focused);
  });

  it.each([
    '<input>', '<textarea></textarea>', '<select><option>Choice</option></select>',
    '<div contenteditable=""><span tabindex="0">Draft</span></div>',
    '<div role="textbox"><span tabindex="0">Draft</span></div>',
    '<div role="slider" tabindex="0"></div>', '<video tabindex="0"></video>', '<audio tabindex="0"></audio>',
    '<div data-testid="videoPlayer"><button>Play</button></div>',
    '<div role="dialog"><button>Dialog</button></div>',
  ])('preserves j/k in editors/dialog/media descendants: %s', (content) => {
    const { document, key, articles } = navigation(post('111', content));
    const control = articles[0].querySelector('input, textarea, select, span, [tabindex], button');
    control.focus();
    for (const letter of ['j', 'k']) expect(key({ key: letter }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(control);
  });

  it('leaves empty targets, pre-cancelled events and open modal interaction untouched', () => {
    const { document, key, articles } = navigation();
    const event = new window.KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(document.activeElement).toBe(document.body);
    document.body.insertAdjacentHTML('beforeend', '<dialog open>Modal</dialog>');
    expect(key({ key: 'j' }).defaultPrevented).toBe(false);
    document.querySelector('dialog').remove();
    articles.forEach((article) => article.remove());
    expect(key({ key: 'k' }).defaultPrevented).toBe(false);
    expect(key({ key: 'j', repeat: true }).defaultPrevented).toBe(false);
  });

  it('j focuses the real article for w/v/c, using actual Save and local check fallback', async () => {
    const { document, key, articles, bounds, rect, open, storage } = navigation();
    await vi.waitFor(() => expect(document.querySelectorAll('.xps-fact-btn')).toHaveLength(3));
    articles[0].focus();
    bounds[0] = rect(-400, -100);
    key({ key: 'j' });
    expect(document.activeElement).toBe(articles[1]);
    key({ key: 'w' });
    expect(open).toHaveBeenCalledWith('https://x.com/person/status/222', expect.any(Object));
    key({ key: 'v' });
    await vi.waitFor(() => expect(JSON.parse(storage.get('xSavedPosts'))).toMatchObject([{ id: '222' }]));
    key({ key: 'c' });
    await vi.waitFor(() => expect(document.querySelector('dialog textarea')?.value).toContain('https://x.com/person/status/222'));
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it.each([
    '<input>', '<textarea></textarea>', '<select><option>Choice</option></select>',
    '<div contenteditable="true"><span tabindex="0">Draft</span></div>',
    '<div role="textbox"><span tabindex="0">Draft</span></div>',
    '<div role="slider" tabindex="0"></div>', '<video tabindex="0"></video>',
    '<div role="dialog"><button>Dialog</button></div>',
    '<dialog open><button>Dialog</button></dialog>',
  ])('preserves Space inside typing, media, and dialog controls: %s', (content) => {
    const { document, key } = setup(content);
    window.scrollBy = vi.fn();
    document.querySelector('input, textarea, select, span, [tabindex], button').focus();
    expect(key({ key: ' ' }).defaultPrevented).toBe(false);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }])('preserves modified/composing Space: %j', (options) => {
    const { key } = setup();
    window.scrollBy = vi.fn();
    expect(key({ key: ' ', ...options }).defaultPrevented).toBe(false);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

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

  it('uses the outer permalink when an unmarked native inline quote timestamp comes first', () => {
    const quote = '<div role="link"><div data-testid="User-Name">Quote author</div><a href="/quote/status/999"><time>Quote date</time></a><div data-testid="tweetText">Quoted text</div></div>';
    const { document, key, open } = setup(`<article tabindex="0">${quote}<a href="/person/status/123"><time>Own date</time></a></article>`);
    document.querySelector('article').focus();
    const before = document.querySelector('[role="link"]').outerHTML;
    expect(key().defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith('https://x.com/person/status/123', { active: false, insert: true, setParent: true });
    expect(document.querySelector('[role="link"]').outerHTML).toBe(before);
  });

  it('does not substitute an unmarked inline quote URL when the outer permalink is absent', () => {
    const { document, key, open } = setup('<article tabindex="0"><div role="link"><div data-testid="User-Name">Quote author</div><a href="/quote/status/999"><time>Quote date</time></a><div data-testid="tweetText">Quoted text</div></div></article>');
    document.querySelector('article').focus();
    expect(key().defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not mistake an author-only role-link wrapper for an inline quote', () => {
    const { document, key, open } = setup('<article tabindex="0"><div role="link"><div data-testid="User-Name">Own author</div><a href="/person/status/123"><time>Own date</time></a></div><div data-testid="tweetText">Own body</div></article>');
    document.querySelector('article').focus();
    expect(key().defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith('https://x.com/person/status/123', { active: false, insert: true, setParent: true });
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
