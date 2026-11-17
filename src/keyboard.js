// Shared typing/media guard for timeline navigation and masonry digit shortcuts.
export const SHORTCUT_CONTROLS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], video, audio, [data-testid="videoPlayer"], [data-testid="audioPlayer"], dialog, [role="dialog"], [role="alertdialog"]';

export function isShortcutControl(event) {
  return [event.target, document.activeElement, ...(event.composedPath?.() || [])]
    .some((node) => node instanceof Element && node.closest(SHORTCUT_CONTROLS));
}
