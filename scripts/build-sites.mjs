import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const output = process.argv[2];
if (!output) throw new Error('Pass the output directory for the bundled Sites Worker.');
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};
const files = ['index.html', 'workspace/index.html', ...(await readdir(resolve(dist, 'assets'))).map((name) => `assets/${name}`)];
const assets = Object.fromEntries(await Promise.all(files.map(async (name) => {
  const type = types[extname(name)];
  if (!type) throw new Error(`Set the MIME type for ${name} before deploying.`);
  const bytes = await readFile(resolve(dist, name));
  return [`/${name}`, { type, base64: bytes.toString('base64') }];
})));

await build({
  configFile: false,
  define: { __BATCHCHECK_ASSETS__: JSON.stringify(assets) },
  build: {
    outDir: resolve(output), emptyOutDir: false, target: 'es2022', minify: 'esbuild',
    lib: { entry: fileURLToPath(new URL('../hosting/sites-entry.mjs', import.meta.url)), formats: ['es'], fileName: () => 'index.js' },
  },
});
