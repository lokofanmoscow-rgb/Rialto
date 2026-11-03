// Сборка веб-части: src/main.js → dist/app.js + статические файлы из public/
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');
const entry = process.env.ENTRY || 'src/main.js';
fs.mkdirSync('dist', { recursive: true });
for (const f of fs.readdirSync('public')) fs.copyFileSync(path.join('public', f), path.join('dist', f));

const opts = {
  entryPoints: [entry],
  bundle: true,
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  format: 'iife',
  target: ['es2019', 'chrome70'],
  outfile: 'dist/app.js',
  legalComments: 'none',
  define: { __DEV__: dev ? 'true' : 'false' },
  logLevel: 'info',
};
if (watch) { const c = await esbuild.context(opts); await c.watch(); }
else await esbuild.build(opts);
