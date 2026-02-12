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
writeFileSync('x-post-saver-enhanced.user.js', header + '\n' + code);
console.log('Built x-post-saver-enhanced.user.js');
