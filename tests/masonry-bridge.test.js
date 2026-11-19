import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';

const { text: code } = buildSync({
  entryPoints: ['src/masonry.js'], bundle:true, write:false,
  format:'iife', globalName:'masonry', loader:{ '.css':'text' },
}).outputFiles[0];

it('exports callable hooks and keeps scroller arguments and results in the page realm', async () => {
  const { window } = new JSDOM(`<main data-testid="primaryColumn"><section>
    <div style="position:absolute"><article role="article">First</article></div>
    <div style="position:absolute"><article role="article">Second</article></div>
  </section></main>`, { url:'https://x.com/home', runScripts:'outside-only', pretendToBeVisual:true });
  try {
    const container = window.document.querySelector('section');
    Object.defineProperty(container, 'clientWidth', { value:1440 });
    const { scroller, original, update, envelope, rect, anchor } = window.eval(`(() => {
      const assert = (ok) => { if (!ok) throw new Error('Permission denied to access object'); };
      const rect = {}, anchor = { offset:300, cursor:() => {} };
      class Candidate {}
      const first = Object.assign(new Candidate(), { itemId:'tweet-1', offset:0, visible:false, item:() => {} });
      const second = { itemId:'tweet-2', offset:320, visible:true };
      const items = [first, second];
      // Model the page refusing a sandbox callback passed to its Array method.
      items.map = function (fn) { assert(fn instanceof Function); return Array.prototype.map.call(this, fn); };
      const envelope = { allItemsWithPositions:items, newRenderedItems:items, nativePayload:() => {} };
      const scroller = {
        state:{ renderedItems:items },
        _getListOffset(a) {
          assert(a instanceof Object && a.cursor === anchor.cursor);
          return a.offset;
        },
        _getRenderCandidates(r) {
          assert(this === scroller && r === rect);
          return envelope;
        },
        _getIsHeightsReady() { return false; },
        _updateRenderedItems(a, r) {
          assert(this === scroller && this._getListOffset(a) === (this._getIsHeightsReady() ? 0 : 300));
          assert(this._getRenderCandidates instanceof Function && this._getIsHeightsReady instanceof Function);
          const result = this._getRenderCandidates(r);
          if (result !== envelope) {
            const demand = result.newRenderedItems;
            assert(result instanceof Object && result.slice instanceof Object && demand instanceof Array);
            assert(result.allItemsWithPositions === items && result.nativePayload === envelope.nativePayload);
            assert(demand[0] instanceof Candidate && demand[0].visible && !first.visible && demand[0].item === first.item);
            assert(demand[1] === second);
          }
          this.lastResult = result;
        },
        _handleScroll() {
          assert(this._updateRenderedItems instanceof Function);
          this._updateRenderedItems(anchor, rect);
        },
      };
      const original = scroller._getRenderCandidates, update = scroller._updateRenderedItems;
      original.apply = update.call = () => assert(false);
      document.querySelector('section').__reactFiber$fixture = {
        stateNode:scroller, memoizedProps:{ onNearBottom() {} },
      };
      return { scroller, original, update, envelope, rect, anchor };
    })()`);

    // Model the Firefox APIs with actual distinct JS realms, not Gecko's
    // wrappers or Tampermonkey's injection policy.
    const sandbox = {
      window, unsafeWindow:window, document:window.document, location:window.location,
      innerWidth:1440, innerHeight:900, getComputedStyle:window.getComputedStyle,
      requestAnimationFrame:window.requestAnimationFrame, cancelAnimationFrame:window.cancelAnimationFrame,
      Event:window.Event, Element:window.Element, MutationObserver:window.MutationObserver,
      ResizeObserver:class { observe() {} disconnect() {} },
      exportFunction(fn, target) {
        expect(target).toBe(window);
        return window.Function('fn', 'return (...args) => fn(...args)')(fn);
      },
      cloneInto(value, target) {
        expect(target).toBe(window);
        expect(Object.values(value).every((field) => typeof field === 'number')).toBe(true);
        return Object.assign(window.eval(Array.isArray(value) ? '[]' : '({})'), value);
      },
    };
    const masonry = runInNewContext(`${code}
      masonry.initMasonry({ read:() => true, write:() => {}, permalink:() => null });
    `, sandbox);
    await vi.waitFor(() => {
      expect(scroller.lastResult?.slice?.end).toBe(2);
      expect(container.classList.contains('xps-masonry-container')).toBe(true);
    });
    expect(anchor.offset).toBe(300);

    const retained = scroller._getRenderCandidates;
    expect(retained).not.toBe(original);
    masonry.toggle();
    expect(scroller._getRenderCandidates).toBe(original);
    expect(scroller._updateRenderedItems).toBe(update);
    expect(scroller._getIsHeightsReady()).toBe(false);
    expect(scroller.lastResult).toBe(envelope);
    expect(retained(rect)).toBe(envelope);
  } finally {
    window.close();
  }
});
