// esbuild loads .css files with the `text` loader (see scripts/build.js), so
// a CSS import resolves to its source text for inlining into the userscript.
declare module '*.css' {
  const css: string;
  export default css;
}
