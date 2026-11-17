import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createMasonryLayout, masonryEntry, matchMasonryCells, masonryPositions, masonryWindow, outerPosts } from '../src/masonry.js';

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

describe('identity-stable masonry placement', () => {
  const items = () => [
    { key:'a', height:100 }, { key:'b', height:250 }, { key:'c', height:80 }, { key:'d', height:90 },
  ];
  function measured(entries, width = 652) {
    const state = createMasonryLayout();
    for (const item of entries) state.measure(item.key, item.height, width, false);
    return state;
  }
  it('commits shortest columns once, moving only downstream y after delayed growth', () => {
    const entries = items(), state = measured(entries);
    const before = state.update(entries, 652);
    expect(before.columns).toEqual([0, 1, 0, 0]);
    state.measure('a', 300, 652, false);
    const after = state.update(entries, 652);
    expect(after.positions).toEqual([
      { top:0, left:0, width:320 }, { top:0, left:332, width:320 },
      { top:312, left:0, width:320 }, { top:404, left:0, width:320 },
    ]);
    expect(after.height).toBe(506);
    expect(after.columns).toEqual(before.columns);
    state.measure('e', 70, 652, false);
    const appended = state.update([...entries, { key:'e', height:70 }], 652);
    expect(appended.positions[4]).toEqual({ top:262, left:332, width:320 });
  });
  it('uses keys across new objects, reorder, insertion and removal, not recycled indexes', () => {
    const entries = items(), state = measured(entries);
    state.update(entries, 652);
    const reordered = [entries[3], entries[1], entries[0], entries[2]].map((item) => ({ ...item }));
    expect(state.update(reordered, 652).columns).toEqual([0, 1, 0, 0]);
    state.measure('new', 40, 652, false);
    const inserted = state.update([{ key:'new', height:40 }, ...reordered], 652);
    expect(inserted.columns.slice(1)).toEqual([0, 1, 0, 0]);
    const removed = state.update(reordered.filter((item) => item.key !== 'b'), 652);
    expect(removed.columns).toEqual([0, 0, 0]);
    expect(state.size()).toEqual({ placements:3, measurements:3 });
  });
  it('preserves column number on same-count widths, resets only when count changes', () => {
    const entries = items(), state = measured(entries);
    state.update(entries, 652);
    state.measure('a', 300, 652, false);
    expect(state.update(entries, 700).columns).toEqual([0, 1, 0, 0]);
    // Three columns legitimately reassign the fourth card to the shortest third column.
    expect(state.update(entries, 1000).columns).toEqual([0, 1, 2, 2]);
    expect(createMasonryLayout().update(entries, 652).columns).toEqual([0, 1, 0, 0]);
  });
  it('does not commit unrendered predictions or transfer a removed key to its replacement', () => {
    const entries = items(), state = createMasonryLayout();
    state.update(entries, 652);
    state.measure('a', 300, 652, false);
    state.measure('b', 250, 652, false);
    state.measure('c', 80, 652, false);
    state.measure('d', 90, 652, false);
    expect(state.update(entries, 652).columns).toEqual([0, 1, 1, 0]);
    // c's old slot now has a different identity and must use the current shortest column.
    state.measure('a', 100, 652, false);
    state.measure('replacement', 80, 652, false);
    const replacement = entries.map((item) => item.key === 'c' ? { ...item, key:'replacement' } : item);
    expect(state.update(replacement, 652).columns).toEqual([0, 1, 0, 0]);
  });
  it('keeps full-width loading barriers, including zero-height rows, without overlapping posts', () => {
    const entries = [...items(), { key:'loader', height:30 }, { key:'e', height:60 }];
    const state = measured(entries);
    state.measure('loader', 30, 652, true);
    let result = state.update(entries, 652);
    expect(result.positions[4]).toEqual({ top:306, left:0, width:652 });
    expect(result.positions[5].top).toBe(348);
    state.measure('loader', 0, 652, true);
    result = state.update(entries, 652);
    expect(result.positions[4]).toEqual({ top:306, left:0, width:652 });
    expect(result.positions[5].top).toBe(306);
  });
  it('bounds measurement history and prunes placements to the loaded list without losing committed columns', () => {
    const state = measured(items()), entries = items();
    const first = state.update(entries, 652);
    for (let i = 0; i < 2500; i++) {
      entries.push({ key:`extra-${i}`, height:100 });
      state.measure(`extra-${i}`, 100, 652, false);
    }
    expect(state.update(entries, 652).columns.slice(0, 4)).toEqual(first.columns);
    expect(state.size()).toEqual({ placements:2504, measurements:2000 });
    state.update(entries.slice(0, 4), 652);
    expect(state.size()).toEqual({ placements:4, measurements:0 });
  });
  it('parses flat and native-wrapped stable identities, rejecting missing identifiers', () => {
    expect(masonryEntry({ id:12, top:900, height:0 })).toMatchObject({ key:'post:12', post:'12', height:320 });
    expect(masonryEntry({ item:{ id:'tweet-12' }, position:900, height:120 })).toMatchObject({ key:'post:12', post:'12', height:120 });
    expect(masonryEntry({ item:{ entryId:'cursor-bottom' }, height:40 })).toMatchObject({ key:'entry:cursor-bottom', post:undefined });
    expect(masonryEntry({ position:1, height:200 })).toBeNull();
    expect(masonryEntry({ id:'' })).toBeNull();
    expect(masonryEntry({ id:NaN })).toBeNull();
    expect(masonryEntry({ id:'tweet-12', position:{ top:100 } })).toMatchObject({ key:'post:12', post:'12' });
  });
  it('recognizes wrapper and primitive list keys without treating coordinates as identity', () => {
    expect(masonryEntry({ item:{ renderData:true }, entryId:'tweet-12', position:{ top:100, bottom:200 } }))
      .toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:'tweet-12', position:{ top:100 } })).toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:{ id:'', entryId:'tweet-12' }, position:null })).toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:{ renderData:true }, position:{ top:100 } })).toBeNull();
  });
  it('covers nonmonotonic per-column positions with a bounded contiguous native window', () => {
    const layout = { positions:[{ top:1000 }, { top:0 }, { top:1100 }, { top:100 }], heights:[200, 200, 200, 200] };
    expect(masonryWindow(layout, 1000, 200)).toEqual({ start:0, end:4 });
    expect(masonryWindow({ positions:[], heights:[] }, 0, 900)).toEqual({ start:0, end:0 });
    const extreme = { positions:Array.from({ length:150 }, () => ({ top:0 })), heights:Array(150).fill(2000) };
    expect(masonryWindow(extreme, 1000, 900)).toBeNull();
  });
  it('separates explicit post IDs from list/promoted keys without guessing suffix IDs', () => {
    expect(masonryEntry({ item:{ id:'promoted-tweet-12-ad' }, entryId:'tweet-12' }))
      .toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:{ id:'list-row-12', entryId:'tweet-12' } }))
      .toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:{ id:'tweet-99' }, entryId:'tweet-12' })).toBeNull();
    expect(masonryEntry({ id:'promoted-tweet-12-ad' }).post).toBeUndefined();
  });
  it('matches reordered posts and a primitive cursor by identity, not child slots', () => {
    const items = ['cursor-bottom', { item:{ id:'list-1' }, entryId:'tweet-1' },
      { item:{ id:'tweet-2' } }].map(masonryEntry);
    const cells = [{ post:true, id:'2' }, { post:true, id:'1' }, { post:false }];
    expect(matchMasonryCells(cells, items, items).map((cell) => cell.item.key))
      .toEqual(['post:2', 'post:1', 'entry:cursor-bottom']);
    // A placeholder cannot borrow a known post's identity.
    expect(matchMasonryCells(cells, items.slice(1), items.slice(1))[2].item).toBeNull();
  });
  it('requires unique row association and refuses duplicate DOM or candidate conflicts', () => {
    const items = [{ id:'tweet-1' }, 'cursor-a', { id:'tweet-2' }, 'cursor-b', { id:'tweet-3' }].map(masonryEntry);
    const cells = [{ post:true, id:'1' }, { post:false }, { post:true, id:'2' },
      { post:false }, { post:true, id:'3' }];
    expect(matchMasonryCells(cells, items, items).map((cell) => cell.item?.key)).toEqual(items.map((item) => item.key));
    expect(matchMasonryCells([{ post:false }, { post:false }], items, items).every((cell) => !cell.item)).toBe(true);
    expect(matchMasonryCells([{ post:true, id:'1' }, { post:true, id:'1' }], items, items)
      .every((cell) => !cell.item)).toBe(true);
    expect(matchMasonryCells([{ post:true, id:'1', postCount:2 }], items, items)[0].item).toBeNull();
    expect(matchMasonryCells([{ post:true, id:'999' }], items, items)[0].item).toBeUndefined();
  });
});
