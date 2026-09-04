export const PANEL_VIEWPORT_MARGIN = 8;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parsePanelPosition(value) {
  if (typeof value !== 'string' || !value) return null;

  try {
    const parsed = JSON.parse(value);
    const x = finiteNumber(parsed?.x);
    const y = finiteNumber(parsed?.y);
    return x == null || y == null ? null : { x, y };
  } catch {
    return null;
  }
}

export function clampPanelPosition(
  position,
  panelSize,
  viewportSize,
  margin = PANEL_VIEWPORT_MARGIN,
) {
  const safeMargin = Math.max(0, finiteNumber(margin) ?? 0);
  const maxX = Math.max(safeMargin, viewportSize.width - panelSize.width - safeMargin);
  const maxY = Math.max(safeMargin, viewportSize.height - panelSize.height - safeMargin);

  return {
    x: Math.min(maxX, Math.max(safeMargin, position.x)),
    y: Math.min(maxY, Math.max(safeMargin, position.y)),
  };
}
