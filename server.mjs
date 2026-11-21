import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { emptyOrder, evolveOrder, otherSide, orderView, parties } from './src/order.js';
import { bearerCode, issueNexconnToken, serviceConfig } from './src/service.js';

const env = process.env;
const staticRoot = fileURLToPath(new URL('./dist', import.meta.url));
const config = serviceConfig(env);
const { appKey, region, job, roles, configured } = config;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const database = configured ? new DatabaseSync(env.BATCH_DATABASE || 'batchcheck.sqlite') : null;
let readOrder;
let updateOrder;
if (database) {
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)');
  database.prepare('INSERT OR IGNORE INTO orders VALUES (?, 0, ?)').run(job.id, JSON.stringify(emptyOrder(job.id)));
  readOrder = database.prepare('SELECT body FROM orders WHERE id = ?');
  updateOrder = database.prepare('UPDATE orders SET revision = ?, body = ? WHERE id = ? AND revision = ?');
}

function loadOrder() {
  return JSON.parse(readOrder.get(job.id).body);
}

const orderStreams = new Map();

function streamOrder(response, side) {
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const heartbeat = setInterval(() => {
    if (!response.write('\n')) response.destroy();
  }, 15_000);
  response.once('close', () => {
    clearInterval(heartbeat);
    orderStreams.delete(response);
  });
  orderStreams.set(response, side);
  response.write(JSON.stringify(orderView(loadOrder(), side)) + '\n');
}

function publishOrder(order) {
  const views = Object.fromEntries(Object.keys(roles).map((side) => [side, JSON.stringify(orderView(order, side)) + '\n']));
  for (const [response, side] of orderStreams) {
    if (!response.write(views[side])) response.destroy();
  }
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new Error('Expected JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('Invalid body.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks));
}

function authenticate(request) {
  const code = bearerCode(request.headers.authorization);
  if (!code) return null;
  const digest = (text) => createHash('sha256').update(text).digest();
  const supplied = digest(code);
  const buyer = timingSafeEqual(supplied, digest(roles.buyer.code));
  const shop = timingSafeEqual(supplied, digest(roles.shop.code));
  return buyer ? 'buyer' : shop ? 'shop' : null;
}

export const server = createServer({ requestTimeout: 15_000, maxHeaderSize: 8192 }, async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === '/api/health' && request.method === 'GET') return json(response, 200, { configured });
    if (pathname.startsWith('/api/')) {
      if (!configured) return json(response, 503, { error: 'Live workspace is not configured yet. The demo is available.' });
      const side = authenticate(request);
      if (!side) return json(response, 401, { error: 'The workspace access code is incorrect.' });
      if (pathname === '/api/chat/session' && request.method === 'POST') {
        let data;
        try {
          data = await readJson(request);
        } catch {
          return json(response, 400, { error: 'Send a valid session request.' });
        }
        if (data?.inbox && data.inbox !== side) {
          return json(response, 403, { error: `This access code belongs to the ${parties[side].label.toLowerCase()} inbox.` });
        }
        try {
          const { userId } = roles[side];
          const token = await issueNexconnToken(config, roles[side]);
          return json(response, 200, { side, userId, peerId: roles[otherSide(side)].userId, appKey, region, token, job });
        } catch {
          return json(response, 502, { error: 'Nexconn could not issue a chat token. Check the console credentials and region.' });
        }
      }
      if (pathname === '/api/order' && request.method === 'GET') {
        return json(response, 200, { order: orderView(loadOrder(), side) });
      }
      if (pathname === '/api/order/events' && request.method === 'GET') {
        streamOrder(response, side);
        return;
      }
      if (pathname === '/api/order' && request.method === 'POST') {
        let action;
        try {
          action = await readJson(request);
        } catch {
          return json(response, 400, { error: 'Send a valid order action.' });
        }
        const current = loadOrder();
        const result = evolveOrder(current, side, action, new Date().toISOString());
        if (result.error) {
          return json(response, result.status, { error: result.error, order: orderView(current, side) });
        }
        const { order } = result;
        if (!updateOrder.run(order.revision, JSON.stringify(order), job.id, current.revision).changes) {
          return json(response, 409, {
            error: 'The order changed. Review the latest version and try again.',
            order: orderView(loadOrder(), side),
          });
        }
        publishOrder(order);
        return json(response, 200, { order: orderView(order, side) });
      }
      return json(response, 404, { error: 'Unknown API route.' });
    }

    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
    const pages = { '/': '/index.html', '/workspace': '/workspace/index.html', '/workspace/': '/workspace/index.html' };
    const requested = Object.hasOwn(pages, pathname) ? pages[pathname] : decodeURIComponent(pathname);
    const file = resolve(staticRoot, `.${requested}`);
    if (!file.startsWith(staticRoot + sep)) return json(response, 404, { error: 'Not found.' });
    const type = contentTypes[extname(file)];
    if (!type) return json(response, 404, { error: 'Not found.' });
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': requested.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(body);
  } catch (error) {
    if (response.headersSent) return response.end();
    if (error.code === 'ENOENT') return json(response, 404, { error: 'Page unavailable. Build the app before starting the server.' });
    if (error instanceof URIError) return json(response, 400, { error: 'Invalid URL.' });
    console.error('BatchCheck request failed', error);
    return json(response, 500, { error: 'The request could not be completed. Try again.' });
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(Number(env.PORT ?? 4173), env.HOST ?? '127.0.0.1', () => {
    console.log(`BatchCheck listening on http://${server.address().address}:${server.address().port}`);
  });
}
