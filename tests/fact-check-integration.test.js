import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';

const code = buildSync({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', loader: { '.css': 'text' } }).outputFiles[0].text;
let window;
afterEach(() => window?.close());
const wait = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
const bar = '<div role="group"><button data-testid="reply"></button><button data-testid="like"></button></div>';
function setup(content) {
  const dom = new JSDOM(content, { url: 'https://x.com/person/status/123', runScripts: 'outside-only' });
  window = dom.window;
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const storage = new Map();
  window.GM_getValue = (key) => storage.get(key);
  window.GM_setValue = (key, value) => storage.set(key, value);
  window.eval(code);
  return { document: window.document, storage };
}

it('injects controls only in the top-level page, not an embedded player frame', async () => {
  const { document } = setup('<article><a href="/person/status/123"><time></time></a>' + bar + '<iframe></iframe></article>');
  const frame = document.querySelector('iframe').contentWindow;
  frame.document.body.innerHTML = '<article><a href="/person/status/123"><time></time></a>' + bar + '</article>';
  frame.eval(code);
  await wait();
  expect(document.querySelector('#xps-panel')).not.toBeNull();
  expect(document.querySelectorAll('.xps-save-btn, .xps-fact-btn')).toHaveLength(2);
  expect(frame.document.querySelector('#xps-panel, #xps-style, .xps-save-btn, .xps-fact-btn')).toBeNull();
});

it('wires real extraction into manual checks, keeps quoted data, and preserves Save/unsave', async () => {
  const { document, storage } = setup('<article><a href="/person/status/123"><time datetime="2026-10-08"></time></a><div data-testid="tweetText">Outer claim</div><div data-testid="embeddedTweet"><article><a href="/source/status/456"><time></time></a><div data-testid="tweetText">Quoted evidence</div></article></div>' + bar + '</article>');
  await wait();
  expect(document.querySelectorAll('.xps-fact-btn')).toHaveLength(1);
  expect(document.querySelector('dialog')).toBeNull();
  expect(storage.has('xSavedPosts')).toBe(false);
  document.querySelector('.xps-fact-btn').click();
  await wait(10);
  const prompt = document.querySelector('dialog textarea').value;
  expect(prompt).toContain('https://x.com/person/status/123');
  expect(prompt).toContain('Outer claim');
  expect(prompt).toContain('https://x.com/source/status/456');
  expect(prompt).toContain('Quoted evidence');
  expect(storage.has('xSavedPosts')).toBe(false);
  document.querySelector('dialog').dispatchEvent(new window.Event('cancel', { cancelable: true }));
  document.querySelector('.xps-save-btn').click();
  await wait(10);
  expect(JSON.parse(storage.get('xSavedPosts'))).toHaveLength(1);
  expect(document.querySelector('.xps-save-btn').textContent).toBe('Saved');
  document.querySelector('.xps-save-btn').click();
  await wait(10);
  expect(JSON.parse(storage.get('xSavedPosts'))).toHaveLength(0);
});

it('places 核查 beside both longform Save buttons and extracts loaded article title/body', async () => {
  const { document } = setup('<article><a href="/person/status/123"><time></time></a><div data-testid="tweetText">Article preview</div><article data-testid="twitterArticleReadView"><a href="/person/status/123"></a><h1 data-testid="twitter-article-title">Article title</h1><div data-testid="twitterArticleRichTextView">Full loaded article body</div>' + bar + '</article>' + bar + '</article>');
  await wait();
  expect(document.querySelectorAll('.xps-save-btn')).toHaveLength(2);
  expect(document.querySelectorAll('.xps-fact-btn')).toHaveLength(2);
  for (const button of document.querySelectorAll('.xps-fact-btn')) {
    expect(button.previousElementSibling.classList.contains('xps-save-btn')).toBe(true);
    button.click(); await wait(10);
    const prompt = document.querySelector('dialog textarea').value;
    expect(prompt).toContain('Article title\n\nFull loaded article body');
    expect(prompt).toContain('https://x.com/person/status/123');
    document.querySelector('dialog').dispatchEvent(new window.Event('cancel', { cancelable: true }));
  }
});

it('does not expand Show more while preparing a check', async () => {
  const { document } = setup('<article><a href="/person/status/123"><time></time></a><div data-testid="tweetText">Loaded text<button id="more">Show more</button></div>' + bar + '</article>');
  let clicks = 0; document.querySelector('#more').addEventListener('click', () => { clicks++; });
  await wait(); document.querySelector('.xps-fact-btn').click(); await wait(10);
  expect(clicks).toBe(0);
  expect(document.querySelector('dialog textarea').value).toContain('Loaded text');
});
