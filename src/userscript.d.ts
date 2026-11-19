/** Page-world window supplied by a userscript manager's unsafeWindow grant. */
declare const unsafeWindow: Window;

/** Firefox's optional content-script APIs for crossing into the page realm. */
declare function exportFunction<T extends (...args: any[]) => any>(fn: T, target: Window): T;
declare function cloneInto<T>(value: T, target: Window): T;
