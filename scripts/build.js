import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Full-face reference copies (Regular/Bold) for manual verification against
// the hosted repo versions (jsDelivr / GitHub Pages); not loaded at runtime.
for (const file of ['IoskeleyMono-Regular.woff2', 'IoskeleyMono-Bold.woff2']) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  cpSync(join(root, 'assets/fonts-src', file), join(root, 'dist', file), { force: true });
}

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
  console.log('Built x-post-saver-enhanced.user.js');
}
