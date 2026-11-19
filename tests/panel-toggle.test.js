import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = buildSync({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'iife', loader: { '.css': 'text' } }).outputFiles[0].text;
const bundle = readFileSync(new URL('../x-post-saver-enhanced.user.js', import.meta.url), 'utf8');
let window;
afterEach(() => window?.close());

describe.each([['source', source], ['generated userscript', bundle]])('%s floating panel', (_name, code) => {
  function setup(masonryEnabled = null, maximumColumns = null) {
    window = new JSDOM('<main>Offline fixture</main>', { url: 'https://x.com/home', runScripts: 'outside-only' }).window;
    const storage = new Map([
      ['xSavedPosts', JSON.stringify([{ id: '123', url: 'https://x.com/person/status/123', text: 'Saved fixture' }])],
      ['xpsFactCheckTemplate', 'Existing custom template'],
      ['xpsPanelPosition', '{"x":120,"y":80}'],
    ]);
    if (masonryEnabled !== null) storage.set('xpsMasonryEnabled', masonryEnabled);
    if (maximumColumns !== null) storage.set('xpsMasonryMaxColumns', maximumColumns);
    window.GM_getValue = (key) => storage.get(key);
    window.GM_setValue = vi.fn((key, value) => storage.set(key, value));
    window.scrollBy = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText } });
    window.eval(code);
    const panel = window.document.querySelector('#xps-panel');
    const toggle = panel.querySelector('.xps-panel-toggle');
    const controls = [...panel.querySelectorAll('button:not(.xps-panel-toggle)')];
    return { storage, panel, toggle, controls, columns: panel.querySelector('select'), writeText };
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
    expect(controls.map((button) => button.textContent)).toEqual(['', 'Export (1)', 'Copy', 'Export URLs', 'Copy URLs', 'Clear', '核查设置', 'Masonry: On']);
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

  it('persists only the separate masonry preference and respects a disabled installation', () => {
    const { storage, toggle, controls } = setup(false);
    const saved = storage.get('xSavedPosts'), template = storage.get('xpsFactCheckTemplate');
    const control = controls.find((button) => button.textContent === 'Masonry: Off');
    expect(control.hidden).toBe(true);
    toggle.click();
    control.click();
    expect(control.textContent).toBe('Masonry: On');
    expect(control.getAttribute('aria-pressed')).toBe('true');
    expect(storage.get('xpsMasonryEnabled')).toBe(true);
    control.click();
    expect(storage.get('xpsMasonryEnabled')).toBe(false);
    expect(storage.get('xSavedPosts')).toBe(saved);
    expect(storage.get('xpsFactCheckTemplate')).toBe(template);
  });

  it('exposes the stored column limit and saves real selections independently of on/off', () => {
    const { storage, toggle, controls, columns } = setup(false, '6');
    expect(columns.getAttribute('aria-label')).toBe('Maximum masonry columns');
    expect(columns.previousElementSibling).toBe(controls.at(-1));
    expect(columns.hidden).toBe(true);
    expect(columns.value).toBe('6');
    toggle.click();
    expect(columns.hidden).toBe(false);
    expect([...columns.options].map((option) => option.value)).toEqual(['Auto', '1', '2', '3', '4', '5', '6']);
    const select = (value) => {
      columns.value = value;
      columns.dispatchEvent(new window.Event('change', { bubbles: true }));
    };
    select('2');
    expect(window.GM_setValue.mock.calls).toEqual([['xpsMasonryMaxColumns', 2]]);
    expect(storage.get('xpsMasonryEnabled')).toBe(false);
    controls.at(-1).click();
    expect(columns.value).toBe('2');
    expect(storage.get('xpsMasonryMaxColumns')).toBe(2);
    select('Auto');
    expect(storage.get('xpsMasonryMaxColumns')).toBe('auto');
    expect(storage.get('xpsMasonryEnabled')).toBe(true);
    columns.focus();
    const space = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    columns.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    expect(window.scrollBy).not.toHaveBeenCalled();
    toggle.click();
    expect(columns.hidden).toBe(true);
    expect(window.document.activeElement).toBe(toggle);
  });

  it.each([undefined, 'auto', 0, -1, 7, 1.5, '2.0', '02', true, {}])('uses Auto for absent, Auto or invalid storage (%j)', (stored) => {
    const { columns } = setup(null, stored);
    expect(columns.value).toBe('Auto');
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

  function pointer(handle, type, options = {}) {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 130, clientY: 90, ...options });
    Object.defineProperties(event, {
      pointerId: { value: options.pointerId ?? 1 },
      isPrimary: { value: options.isPrimary ?? true },
    });
    handle.dispatchEvent(event);
    return event;
  }

  function mockGeometry(panel, handle) {
    // jsdom has no layout; establish the stored rectangle for pointer arithmetic.
    panel.style.left = '120px';
    panel.style.top = '80px';
    panel.getBoundingClientRect = () => ({
      left: parseFloat(panel.style.left), top: parseFloat(panel.style.top), width: 36, height: 36,
    });
    let captured = false;
    handle.setPointerCapture = vi.fn(() => { captured = true; });
    handle.hasPointerCapture = () => captured;
    handle.releasePointerCapture = vi.fn(() => { captured = false; });
  }

  it('drags the circle without toggling, saves position, then allows a genuine click', () => {
    const { panel, toggle, storage } = setup();
    mockGeometry(panel, toggle);
    expect(pointer(toggle, 'pointerdown').defaultPrevented).toBe(false);
    pointer(toggle, 'pointermove', { clientX: 160, clientY: 110 });
    expect(panel.dataset.dragging).toBe('1');
    pointer(toggle, 'pointerup');
    expect(panel.dataset.dragging).toBeUndefined();
    expect(JSON.parse(storage.get('xpsPanelPosition'))).toEqual({ x: 150, y: 100 });
    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    pointer(toggle, 'pointerdown');
    pointer(toggle, 'pointerup');
    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps jitter as a click and ignores nonprimary or secondary-button starts', () => {
    const { panel, toggle } = setup();
    mockGeometry(panel, toggle);
    for (const options of [{ isPrimary: false }, { button: 2 }]) {
      pointer(toggle, 'pointerdown', options);
      pointer(toggle, 'pointermove', { clientX: 200 });
      expect(toggle.setPointerCapture).not.toHaveBeenCalled();
      expect(panel.style.left).toBe('120px');
    }
    pointer(toggle, 'pointerdown');
    pointer(toggle, 'pointermove', { clientX: 133, clientY: 92 });
    pointer(toggle, 'pointerup');
    expect(window.GM_setValue).not.toHaveBeenCalled();
    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['pointercancel', 'lostpointercapture'])('cleans up %s and retains keyboard activation and movement', (ending) => {
    const { panel, toggle } = setup();
    mockGeometry(panel, toggle);
    pointer(toggle, 'pointerdown');
    pointer(toggle, 'pointermove', { clientX: 160 });
    pointer(toggle, ending, { pointerId: 2 });
    expect(panel.dataset.dragging).toBe('1');
    pointer(toggle, ending);
    expect(panel.dataset.dragging).toBeUndefined();
    pointer(toggle, 'pointermove', { clientX: 300 });
    expect(panel.style.left).toBe('150px');
    toggle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(panel.style.left).toBe('134px');
    toggle.click(); // Keyboard/programmatic activation has detail 0, not the trailing pointer click.
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
