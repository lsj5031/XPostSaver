import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

const header = readFileSync('src/header.js', 'utf8');

const result = buildSync({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
  minify: false,
  keepNames: true,
});

const code = result.outputFiles[0].text;
const output = header + '\n' + code;

if (process.argv.includes('--check')) {
  const existing = readFileSync('x-post-saver-enhanced.user.js', 'utf8');
  if (existing !== output) {
    console.error('Generated userscript is out of date. Run npm run build.');
    process.exitCode = 1;
  } else {
    console.log('Generated userscript is up to date.');
  }
} else {
  writeFileSync('x-post-saver-enhanced.user.js', output);
  console.log('Built x-post-saver-enhanced.user.js');
}
