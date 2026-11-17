// Shared typing/media guard for timeline navigation and masonry digit shortcuts.
export const SHORTCUT_CONTROLS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], video, audio, [data-testid="videoPlayer"], [data-testid="audioPlayer"], dialog, [role="dialog"], [role="alertdialog"]';

export function isShortcutControl(event) {
  return [event.target, document.activeElement, ...(event.composedPath?.() || [])]
    .some((node) => node instanceof Element && node.closest(SHORTCUT_CONTROLS));
}

// Shared by all userscript handlers so native a+Space does not page the feed.
// Cache per event: multiple handlers must observe one prefix transition, not consume it.
let prefixUntil = 0;
const prefixEvents = new WeakMap();
export function isNativeShortcutSequence(event) {
  if (prefixEvents.has(event)) return prefixEvents.get(event);
  let native = false;
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
      !event.isComposing && event.keyCode !== 229 && !isShortcutControl(event)) {
    if (['g', 'a'].includes(event.key)) {
      prefixUntil = Date.now() + 1500;
      native = true;
    } else if (Date.now() < prefixUntil && event.key.length === 1) {
      if (!event.repeat) prefixUntil = 0;
      native = true;
    }
  }
  prefixEvents.set(event, native);
  return native;
}
