import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = buildSync({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', loader: { '.css': 'text' } }).outputFiles[0].text;
const bundle = readFileSync(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
let window;
afterEach(() => window?.close());

describe.each([['source', source], ['generated userscript', bundle]])('%s floating panel', (_name, code) => {
  function setup() {
    window = new JSDOM('<main>Offline fixture</main>', { url: 'https://x.com/home', runScripts: 'outside-only' }).window;
    const storage = new Map([
      ['xSavedPosts', JSON.stringify([{ id: '123', url: 'https://x.com/person/status/123', text: 'Saved fixture' }])],
      ['xpsFactCheckTemplate', 'Existing custom template'],
      ['xpsPanelPosition', '{"x":120,"y":80}'],
    ]);
    window.GM_getValue = (key) => storage.get(key);
    window.GM_setValue = vi.fn((key, value) => storage.set(key, value));
    window.scrollBy = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText } });
    window.eval(code);
    const panel = window.document.querySelector('#xps-panel');
    const toggle = panel.querySelector('.xps-panel-toggle');
    const controls = [...panel.querySelectorAll('button:not(.xps-panel-toggle)')];
    return { storage, panel, toggle, controls, writeText };
  }

  it('starts collapsed, exposes working actions only when expanded, and preserves stored data', async () => {
    const { storage, panel, toggle, controls, writeText } = setup();
    const before = [...storage];
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand X Post Saver panel');
    expect(controls.every((button) => button.hidden && window.getComputedStyle(button).display === 'none')).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(controls.every((button) => !button.hidden)).toBe(true);
    expect(controls.map((button) => button.textContent)).toEqual(['', 'Export (1)', 'Copy', 'Export URLs', 'Copy URLs', 'Clear', '核查设置']);
    controls.find((button) => button.textContent === 'Copy URLs').click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://x.com/person/status/123\n');
    controls.find((button) => button.textContent === 'Copy').click();
    await Promise.resolve();
    expect(JSON.parse(writeText.mock.lastCall[0]).text).toBe('Saved fixture');
    controls[1].focus();
    toggle.click();
    expect(window.document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(controls.every((button) => button.hidden)).toBe(true);
    expect(panel.dataset.collapsed).toBe('true');
    expect([...storage]).toEqual(before);
    expect(window.GM_setValue).not.toHaveBeenCalled();
  });

  it('allows native toggle Space without changing Space paging on other controls', () => {
    const { toggle, controls } = setup();
    toggle.focus();
    const space = () => {
      const event = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      window.document.activeElement.dispatchEvent(event);
      return event;
    };
    expect(space().defaultPrevented).toBe(false);
    expect(window.scrollBy).not.toHaveBeenCalled();
    // jsdom has no native keyboard button activation; Chromium covers Enter/Space clicks.
    toggle.click();
    controls[1].focus();
    expect(space().defaultPrevented).toBe(true);
    expect(window.scrollBy).toHaveBeenCalledTimes(1);
  });
});
