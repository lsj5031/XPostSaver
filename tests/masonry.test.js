import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createMasonryLayout, masonryColumnCount, masonryEntry, matchMasonryCells, masonryPositions, masonryWindow, outerPosts } from '../src/masonry.js';

describe('standalone masonry', () => {
  it('keeps the Auto width thresholds and caps only when a limit is selected', () => {
    expect([651, 652, 983, 984, 2560].map((width) => masonryColumnCount(width))).toEqual([1, 2, 2, 3, 7]);
    expect([651, 652, 983, 984, 2560].map((width) => masonryColumnCount(width, 2))).toEqual([1, 2, 2, 2, 2]);
    expect(masonryColumnCount(2560, 6)).toBe(6);
  });
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
  it('reflows at the same feed width and remeasures cards, but not full-width rows', () => {
    const entries = [...items(), { key:'loader', fullRow:true }], state = measured(entries);
    state.update(entries, 1000);
    state.measure('a', 160, 1000, false);
    state.measure('loader', 20, 1000, true);
    expect(state.hasMeasurement('a')).toBe(true);
    const capped = state.update(entries, 1000, 1);
    expect(capped.columns).toEqual([0, 0, 0, 0]);
    expect(capped.positions[1]).toEqual({ top:172, left:0, width:1000 });
    expect(state.hasMeasurement('a')).toBe(false);
    expect(state.hasMeasurement('loader')).toBe(true);
    state.measure('a', 120, 1000, false, 1);
    expect(state.hasMeasurement('a')).toBe(true);
    expect(state.update(entries, 1000, 1).positions[1].top).toBe(132);
    expect(state.update(entries, 1000).positions[2]).toEqual({ top:0, left:674.6666666666666, width:325.3333333333333 });
    expect(state.hasMeasurement('a')).toBe(false);
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
  it('retains resolved loaded-list geometry after measurement LRU eviction without restarting prefix resolution', () => {
    const state = createMasonryLayout();
    const entries = Array.from({ length:2200 }, (_, i) => ({ key:`slot-${i}`, height:600 }));
    state.update(entries, 1374);
    entries.forEach((item) => state.measure(item.key, 200, 1374, false));
    const measured = state.update(entries, 1374);
    expect(state.size()).toEqual({ placements:2200, measurements:2000 });
    expect(state.hasMeasurement(entries[0].key)).toBe(false);
    // The first 200 never committed a measurement before eviction. Once a
    // bounded window commits, its physical geometry survives cache eviction.
    const prefix = createMasonryLayout();
    prefix.update(entries, 1374);
    for (let start = 0; start < entries.length; start += 100) {
      entries.slice(start, start + 100).forEach((item) => prefix.measure(item.key, 200, 1374, false));
      prefix.update(entries, 1374);
    }
    expect(prefix.hasMeasurement(entries[0].key)).toBe(true);
    expect(prefix.update(entries, 1374).heights.every((height) => height === 200)).toBe(true);
    expect(measured.heights.slice(200).every((height) => height === 200)).toBe(true);
  });
  it('recognizes wrapper and primitive list keys without treating coordinates as identity', () => {
    expect(masonryEntry({ item:{ renderData:true }, entryId:'tweet-12', position:{ top:100, bottom:200 } }))
      .toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:'tweet-12', position:{ top:100 } })).toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:{ id:'', entryId:'tweet-12' }, position:null })).toMatchObject({ key:'post:12', post:'12' });
    expect(masonryEntry({ item:{ renderData:true }, position:{ top:100 } })).toBeNull();
    expect(masonryEntry({ itemId:'timeline-row-12', offset:900, visible:false, height:600 }))
      .toMatchObject({ key:'entry:timeline-row-12', post:undefined, height:600 });
  });
  it('translates a disconnected measured run without shearing its columns as its prefix resolves', () => {
    const state = createMasonryLayout();
    const entries = ['u', 'v', 'a', 'b', 'c', 'd'].map((key) => ({ key, height:600 }));
    state.update(entries, 652);
    state.startRun('a');
    for (const [i, item] of entries.slice(2).entries()) state.measure(item.key, 100 + 30 * i, 652, false);
    const before = state.update(entries, 652);
    state.measure('u', 60, 652, false);
    state.measure('v', 200, 652, false);
    const after = state.update(entries, 652);
    expect(after.positions[0].top).toBe(0);
    for (let i = 2; i < entries.length; i++) {
      expect(after.positions[i].left).toBe(before.positions[i].left);
      expect(after.positions[i].top - before.positions[i].top).toBe(-400);
    }
    expect(state.hasMeasurement('a')).toBe(true);
    state.update(entries, 690);
    expect(state.hasMeasurement('a')).toBe(false);
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
