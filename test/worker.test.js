import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createWorker } from '../hosting/worker.mjs';

function sqliteBinding() {
  const database = new DatabaseSync(':memory:');
  const binding = {
    prepare(sql) {
      const statement = database.prepare(sql);
      function bound(params) {
        return {
          bind: (...next) => bound(next),
          first: async () => statement.get(...params) ?? null,
          run: async () => ({ meta: { changes: statement.run(...params).changes } }),
        };
      }
      return bound([]);
    },
    withSession(constraint) {
      assert.equal(constraint, 'first-primary');
      return binding;
    },
  };
  return { database, binding };
}

test('hosted worker serves both inboxes and protects persisted approvals', async () => {
  const { database, binding } = sqliteBinding();
  database.exec(await readFile(new URL('../drizzle/0000_orders.sql', import.meta.url), 'utf8'));
  const worker = createWorker({
    '/index.html': { type: 'text/html', base64: Buffer.from('BatchCheck home').toString('base64') },
    '/workspace/index.html': { type: 'text/html', base64: Buffer.from('BatchCheck inbox').toString('base64') },
  });
  const env = {
    DB: binding,
    NEXCONN_APP_KEY: 'fixture-key',
    NEXCONN_APP_SECRET: 'fixture-secret',
    NEXCONN_BUYER_ID: 'FixtureBuyer123456',
    NEXCONN_SHOP_ID: 'FixtureShop1234567',
    BUYER_ACCESS_CODE: 'sample-buyer-code-0011223344',
    SHOP_ACCESS_CODE: 'sample-shop-code-5566778899',
  };

  const buyer = env.BUYER_ACCESS_CODE;
  const shop = env.SHOP_ACCESS_CODE;
  const call = (path, { method = 'GET', code, data, configuration = env } = {}) => worker.fetch(
    new Request('https://batchcheck.example' + path, {
      method,
      headers: {
        ...(code && { Authorization: `Bearer ${code}` }),
        ...(data && { 'Content-Type': 'application/json' }),
      },
      ...(data && { body: JSON.stringify(data) }),
    }),
    configuration,
  );
  const post = (path, code, data) => call(path, { method: 'POST', code, data });
  const realFetch = globalThis.fetch;
  const tokenRequests = [];
  globalThis.fetch = async (url, { headers, body }) => {
    assert.equal(url, 'https://api.sg-light-api.com/v4/auth/access-token/issue');
    assert.equal(headers.Signature, createHash('sha1').update(env.NEXCONN_APP_SECRET + headers.Nonce + headers.Timestamp).digest('hex'));
    const { userId } = JSON.parse(body);
    tokenRequests.push(userId);
    return Response.json({ code: 0, result: { userId, accessToken: 'fixture-token' } });
  };

  try {
    assert.equal(await (await call('/')).text(), 'BatchCheck home');
    assert.equal(await (await call('/workspace/?inbox=buyer')).text(), 'BatchCheck inbox');
    assert.equal(await (await call('/workspace/?inbox=shop')).text(), 'BatchCheck inbox');
    assert.deepEqual(await (await call('/api/health', { configuration: { DB: binding } })).json(), { configured: false, storage: 'ready' });
    assert.deepEqual(await (await call('/api/health')).json(), { configured: true, storage: 'ready' });
    assert.equal((await call('/api/order', { code: 'x'.repeat(30) })).status, 401);
    assert.equal((await post('/api/chat/session', buyer, { inbox: 'shop' })).status, 403);
    assert.deepEqual(tokenRequests, []);
    const session = await (await post('/api/chat/session', buyer, { inbox: 'buyer' })).json();
    assert.equal(session.token, 'fixture-token');
    assert.equal(session.peerId, env.NEXCONN_SHOP_ID);
    assert.equal(Object.hasOwn(session, 'appSecret'), false);

    const values = { quantity: '80', garment: 'Cotton', color: 'Green', artwork: 'V2' };
    assert.equal((await post('/api/order', buyer, { type: 'submit', revision: 0, values })).status, 200);
    const privateView = await (await call('/api/order', { code: shop })).json();
    assert.deepEqual(privateView.order.readbacks.buyer, {});
    const second = await post('/api/order', shop, { type: 'submit', revision: 1, values });
    assert.deepEqual((await second.json()).order.readbacks.buyer, values);
    assert.equal((await call('/api/order/events', { code: buyer })).status, 204);
    const results = await Promise.all([buyer, shop].map((code) => post('/api/order', code, { type: 'approve', revision: 2 })));
    assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
    const unapproved = results[0].status === 409 ? buyer : shop;
    const locked = await post('/api/order', unapproved, { type: 'approve', revision: 3 });
    assert.ok((await locked.json()).order.lockedAt);
    assert.equal((await post('/api/order', buyer, { type: 'reopen', revision: 4, field: 'artwork' })).status, 409);
  } finally {
    globalThis.fetch = realFetch;
    database.close();
  }
});
