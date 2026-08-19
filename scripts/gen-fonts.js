// Generates src/main.css from the Ioskeley Mono faces.
//
// Iosevka is a variable font, so it exposes one TrueType (glyf) master per
// named instance. We can't simply recolor a static woff2 at build time (it
// ships one outline + metrics only), so the script reads the master the
// author cut per weight:
//
//   weight 400 -> IoskeleyMono-Regular (the plain Iosevka cut)
//   weight 700 -> IoskeleyMono-Bold    (the "Bold" instance)
//
// Only the upright weights the UI uses are embedded; italics are never set.
//
// Font source (SIL OFL 1.1, (c) 2025 Ahmed Hatem):
//   https://github.com/ahatem/IoskeleyMono
//   https://ahatem.github.io/IoskeleyMono/
//   https://cdn.jsdelivr.net/gh/ahatem/IoskeleyMono@main/site/fonts/
//
// The repo publishes the full face library on jsDelivr / GitHub Pages; we
// keep the two exact woff2 files the user asked for under assets/fonts-src/
// and subset them to the UI's ASCII character set to keep the userscript
// small. x.com's CSP is `font-src 'self' https://*.twimg.com data:;`, so the
// built userscript must load the font as an inline data: URI rather than a
// remote URL (a remote @font-face is blocked, a CSS <link> is not).

import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, cpSync, rmSync, mkdtempSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const venv = join(root, '.fonttools-venv');

// Characters rendered by the UI: buttons, panel, and all toast strings.
// Kept ASCII so the embedded faces stay small; add here if new UI text
// (e.g. punctuation) appears.
const TEXT = 'SaveSavedExportCopyClearURLS()';

function subsetToDataUri(weight) {
  const py = existsSync(join(venv, 'bin', 'pyftsubset'))
    ? join(venv, 'bin', 'pyftsubset')
    : 'pyftsubset';

  const dir = mkdtempSync(join(tmpdir(), 'xps-font-'));
  const out = join(dir, `${weight}.woff2`);
  try {
    execFileSync(
      py,
      [
        join(root, 'assets/fonts-src', `IoskeleyMono-${weight}.woff2`),
        `--text=${TEXT}`,
        '--flavor=woff2',
        '--layout-features=*',
        '--name-IDs=*',
        '--notdef-glyph',
        `--output-file=${out}`,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    const woff2 = readFileSync(out);
    const base64 = Buffer.from(woff2).toString('base64');
    const sizeKb = Math.ceil(woff2.length / 1024);
    console.log(`  ${weight}  ${sizeKb} KB woff2  ${(base64.length / 1024).toFixed(1)} KB base64`);
    return base64;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const regular = subsetToDataUri('Regular');
const bold = subsetToDataUri('Bold');

const css = `/*
  Ioskeley Mono — Iosevka configured to mimic Berkeley Mono.
  SIL Open Font License 1.1, (c) 2025 Ahmed Hatem.
  https://github.com/ahatem/IoskeleyMono

  Subset to the UI character set by scripts/gen-fonts.js. Hosted at
  https://ahatem.github.io/IoskeleyMono/fonts/ and
  https://cdn.jsdelivr.net/gh/ahatem/IoskeleyMono@main/site/fonts/
  (full faces); x.com's CSP allows data: URIs but not those hosts, so the
  built userscript embeds them.
*/
@font-face {
  font-family: 'Ioskeley Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('data:font/woff2;base64,${regular}') format('woff2');
}
@font-face {
  font-family: 'Ioskeley Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('data:font/woff2;base64,${bold}') format('woff2');
}

button.xps-save-btn {
  appearance: none;
  border: 1px solid rgba(128, 128, 128, 0.35);
  background: transparent;
  color: inherit;
  cursor: pointer;
  user-select: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* X action bars use align-items: stretch; with an explicit height the
     pill would top-align, so center it against the native icon buttons. */
  align-self: center;
  height: 30px;
  padding: 0 10px;
  margin-left: 8px;
  border-radius: 999px;
  font-family: 'Ioskeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}

button.xps-save-btn:hover {
  background: rgba(29, 155, 240, 0.12);
  border-color: rgba(29, 155, 240, 0.6);
}

button.xps-save-btn.xps-saved {
  border-color: rgba(0, 186, 124, 0.75);
  color: rgba(0, 186, 124, 1);
}

button.xps-save-btn.xps-saved:hover {
  background: rgba(0, 186, 124, 0.12);
}

.xps-save-label {
  font-weight: 700;
}
`;

writeFileSync(join(root, 'src', 'main.css'), css);
console.log(`Wrote src/main.css (${(css.length / 1024).toFixed(1)} KB)`);

// Copy the UI CSS into the userscript build so esbuild inlines the
// @font-face data URIs.
const header = readFileSync(join(root, 'src', 'header.js'), 'utf8');
const result = buildSync({
  entryPoints: [join(root, 'src', 'main.js')],
  outfile: join(root, 'x-post-saver-enhanced.user.js'),
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
  loader: { '.css': 'text' },
  minify: false,
  keepNames: true,
});

const code = result.outputFiles[0].text;
const output = header + '\n' + code;

if (process.argv.includes('--check')) {
  const existing = readFileSync(join(root, 'x-post-saver-enhanced.user.js'), 'utf8');
  if (existing !== output) {
    console.error('Generated userscript is out of date. Run npm run build.');
    process.exitCode = 1;
  } else {
    console.log('Generated userscript is up to date.');
  }
} else {
  writeFileSync(join(root, 'x-post-saver-enhanced.user.js'), output);
  console.log(`Built x-post-saver-enhanced.user.js (${(output.length / 1024).toFixed(1)} KB)`);
}

// Keep a full-face reference copy of the two source faces in the output for
// manual verification against the hosted repo versions (jsDelivr / GitHub
// Pages). Not referenced at runtime — the UI loads the embedded subset.
for (const file of ['IoskeleyMono-Regular.woff2', 'IoskeleyMono-Bold.woff2']) {
  cpSync(join(root, 'assets/fonts-src', file), join(root, 'dist', file), { force: true });
}
