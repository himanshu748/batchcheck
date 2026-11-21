import { emptyOrder, evolveOrder, orderView, otherSide, parties } from '../src/order.js';
import { authenticateCode, issueNexconnToken, serviceConfig } from '../src/service.js';

const responseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const pagePaths = { '/': '/index.html', '/workspace': '/workspace/index.html', '/workspace/': '/workspace/index.html' };

function json(body, status = 200) {
  return Response.json(body, { status, headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
}

async function readJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !request.body) {
    throw new Error('Expected JSON.');
  }
  const decoder = new TextDecoder();
  const reader = request.body.getReader();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new Error('Invalid body.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function orderStore(database, id) {
  const db = database.withSession('first-primary');
  return {
    async read() {
      const row = await db.prepare('SELECT body FROM orders WHERE id = ?').bind(id).first();
      return row ? JSON.parse(row.body) : emptyOrder(id);
    },
    async write(order, previousRevision) {
      const result = await db.prepare(`
        INSERT INTO orders (id, revision, body) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, body = excluded.body
        WHERE orders.revision = ?
      `).bind(id, order.revision, JSON.stringify(order), previousRevision).run();
      return result.meta.changes === 1;
    },
  };
}

async function health(config, database) {
  let storage = 'unavailable';
  if (database) {
    try {
      await database.prepare('SELECT 1 FROM orders LIMIT 1').first();
      storage = 'ready';
    } catch {
      // A deployment can serve its demo while the database is being initialized.
    }
  }
  return json({ configured: config.configured && storage === 'ready', storage });
}

async function handleApi(request, path, env) {
  const config = serviceConfig(env);
  if (path === '/api/health' && request.method === 'GET') return health(config, env.DB);
  if (!config.configured || !env.DB) {
    return json({ error: 'Live workspace is not configured yet. The demo is available.' }, 503);
  }
  const { job, roles, appKey, region } = config;
  const side = await authenticateCode(request.headers.get('authorization'), roles);
  if (!side) return json({ error: 'The workspace access code is incorrect.' }, 401);

  if (path === '/api/chat/session' && request.method === 'POST') {
    let data;
    try {
      data = await readJson(request);
    } catch {
      return json({ error: 'Send a valid session request.' }, 400);
    }
    if (data?.inbox && data.inbox !== side) {
      return json({ error: `This access code belongs to the ${parties[side].label.toLowerCase()} inbox.` }, 403);
    }
    const user = roles[side];
    try {
      const token = await issueNexconnToken(config, user);
      return json({ side, userId: user.userId, peerId: roles[otherSide(side)].userId, appKey, region, token, job });
    } catch {
      return json({ error: 'Nexconn could not issue a chat token. Check the console credentials and region.' }, 502);
    }
  }

  if (path === '/api/order/events' && request.method === 'GET') {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  if (path === '/api/order') {
    const store = orderStore(env.DB, job.id);
    if (request.method === 'GET') return json({ order: orderView(await store.read(), side) });
    if (request.method === 'POST') {
      let action;
      try {
        action = await readJson(request);
      } catch {
        return json({ error: 'Send a valid order action.' }, 400);
      }
      const current = await store.read();
      const result = evolveOrder(current, side, action, new Date().toISOString());
      if (result.error) return json({ error: result.error, order: orderView(current, side) }, result.status);
      if (!await store.write(result.order, current.revision)) {
        return json({
          error: 'The order changed. Review the latest version and try again.',
          order: orderView(await store.read(), side),
        }, 409);
      }
      return json({ order: orderView(result.order, side) });
    }
  }

  return json({ error: 'Unknown API route.' }, 404);
}

export function createWorker(assets) {
  return {
    async fetch(request, env) {
      const path = new URL(request.url).pathname;
      try {
        if (path.startsWith('/api/')) return await handleApi(request, path, env);
        if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed.' }, 405);
        const key = Object.hasOwn(pagePaths, path) ? pagePaths[path] : path;
        if (!Object.hasOwn(assets, key)) return json({ error: 'Page not found.' }, 404);
        const { type, base64 } = assets[key];
        return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0)), {
          headers: {
            ...responseHeaders,
            'Content-Type': type,
            'Cache-Control': key.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
          },
        });
      } catch {
        return json({ error: 'The request could not be completed. Try again.' }, 500);
      }
    },
  };
}
