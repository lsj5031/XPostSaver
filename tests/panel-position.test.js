import { describe, expect, it } from 'vitest';
import { clampPanelPosition, parsePanelPosition } from '../src/panel-position.js';

describe('parsePanelPosition', () => {
  it('parses a stored finite position', () => {
    expect(parsePanelPosition('{"x":120.5,"y":64}')).toEqual({ x: 120.5, y: 64 });
  });

  it('rejects malformed and non-finite positions', () => {
    expect(parsePanelPosition('not json')).toBeNull();
    expect(parsePanelPosition('{"x":10}')).toBeNull();
    expect(parsePanelPosition('{"x":"10","y":20}')).toBeNull();
  });
});

describe('clampPanelPosition', () => {
  const panel = { width: 300, height: 56 };
  const viewport = { width: 1000, height: 800 };

  it('leaves an in-bounds position unchanged', () => {
    expect(clampPanelPosition({ x: 200, y: 300 }, panel, viewport)).toEqual({ x: 200, y: 300 });
  });

  it('keeps every edge inside the viewport margin', () => {
    expect(clampPanelPosition({ x: -100, y: 900 }, panel, viewport)).toEqual({
      x: 8,
      y: 736,
    });
  });

  it('anchors an oversized panel at the margin', () => {
    expect(
      clampPanelPosition(
        { x: 500, y: 500 },
        { width: 1100, height: 900 },
        viewport,
      ),
    ).toEqual({ x: 8, y: 8 });
  });
});
