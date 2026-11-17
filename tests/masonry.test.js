import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { masonryPositions, outerPosts } from '../src/masonry.js';

describe('standalone masonry', () => {
  it('packs unequal heights into the shortest column with no empty row cells', () => {
    const result = masonryPositions([100, 250, 80, 90], 2, 652);
    expect(result.positions).toEqual([
      { top: 0, left: 0, width: 320 }, { top: 0, left: 332, width: 320 },
      { top: 112, left: 0, width: 320 }, { top: 204, left: 0, width: 320 },
    ]);
    expect(result.height).toBe(306);
  });
  it('counts top-level posts, not nested quotes or wrapper markers', () => {
    const dom = new JSDOM(`<main><div data-testid="tweet"><article role="article"><article role="article">quote</article></article></div><article role="article">second</article></main>`);
    expect(outerPosts(dom.window.document.querySelector('main'))).toHaveLength(2);
  });
  it('puts loading rows after all columns without allocating blank grid cells', () => {
    const result = masonryPositions([100, 250, 0, 30, 90], 2, 652, 12, new Set([2, 3]));
    expect(result.positions[2]).toEqual({ top:262, left:0, width:652 });
    expect(result.positions[3]).toEqual({ top:262, left:0, width:652 });
    expect(result.positions[4]).toEqual({ top:304, left:0, width:320 });
  });
});
