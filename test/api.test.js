import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, on, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { watchOrder } from '../src/live.js';

test('authorizes, streams role-scoped order changes, and rejects racing writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'batchcheck-api-'));
  const buyerCode = 'test-buyercode-AAABBBCCCDDD';
  const shopCode = 'test-shop-code-DDDCCCBBBAAA';
  Object.assign(process.env, {
    NEXCONN_APP_KEY: 'fake-app-key',
    NEXCONN_APP_SECRET: 'fixture-secret',
    NEXCONN_REGION: 'sg',
    NEXCONN_BUYER_ID: 'FakeBuyer12345678',
    NEXCONN_SHOP_ID: 'FakeShop123456789',
    BUYER_ACCESS_CODE: buyerCode,
    SHOP_ACCESS_CODE: shopCode,
    BATCH_DATABASE: join(directory, 'orders.sqlite'),
  });
  const { server } = await import('../server.mjs');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/order/events') return originalFetch(`http://127.0.0.1:${port}${url}`, options);
    if (url !== 'https://api.sg-light-api.com/v4/auth/access-token/issue') return originalFetch(url, options);
    const input = JSON.parse(options.body);
    requests.push(input);
    assert.equal(options.headers['App-Key'], 'fake-app-key');
    assert.equal(options.headers.Signature, createHash('sha1').update(
      'fixture-secret' + options.headers.Nonce + options.headers.Timestamp,
    ).digest('hex'));
    return Response.json({ code: 0, result: { userId: input.userId, accessToken: 'fixture-token' } });
  };
  async function api(path, code, body) {
    const response = await originalFetch(`http://127.0.0.1:${port}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(code && { Authorization: `Bearer ${code}` }),
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }

  const streamController = new AbortController();
  const signal = AbortSignal.any([streamController.signal, AbortSignal.timeout(5000)]);
  const buyerEvents = new EventEmitter();
  const shopEvents = new EventEmitter();
  const watch = (code, emitter) => watchOrder(code, signal, (order) => emitter.emit('order', order))
    .catch((failure) => { if (!signal.aborted) emitter.emit('error', failure); });
  async function waitForOrder(emitter, revision) {
    for await (const [order] of on(emitter, 'order', { signal })) {
      if (order.revision === revision) return order;
    }
  }
  let streams = [];

  try {
    assert.deepEqual((await api('/health')).data, { configured: true });
    assert.equal((await api('/order')).status, 401);
    assert.equal((await api('/order/events')).status, 401);
    const wrongInbox = await api('/chat/session', shopCode, { inbox: 'buyer' });
    assert.equal(wrongInbox.status, 403);
    assert.deepEqual(requests, []);
    const session = await api('/chat/session', buyerCode, { inbox: 'buyer' });
    assert.equal(session.status, 200);
    assert.deepEqual(requests.map(({ userId }) => userId), ['FakeBuyer12345678']);
    assert.equal(session.data.side, 'buyer');
    assert.equal(session.data.peerId, 'FakeShop123456789');
    assert.equal(session.data.token, 'fixture-token');
    assert.ok(!JSON.stringify(session.data).includes('fixture-secret'));

    const values = { quantity: '80', garment: 'Cotton', color: 'Green', artwork: 'V2' };
    const initial = [waitForOrder(buyerEvents, 0), waitForOrder(shopEvents, 0)];
    streams = [watch(buyerCode, buyerEvents), watch(shopCode, shopEvents)];
    for (const snapshot of await Promise.all(initial)) assert.equal(snapshot.revision, 0);

    const afterBuyer = [waitForOrder(buyerEvents, 1), waitForOrder(shopEvents, 1)];
    const first = await api('/order', buyerCode, { type: 'submit', revision: 0, values });
    assert.equal(first.status, 200);
    const [buyerView, shopView] = await Promise.all(afterBuyer);
    assert.deepEqual(buyerView.readbacks.buyer, values);
    assert.deepEqual(shopView.readbacks.buyer, {});
    assert.deepEqual((await api('/order', shopCode)).data.order.readbacks.buyer, {});
    const afterShop = waitForOrder(buyerEvents, 2);
    const second = await api('/order', shopCode, { type: 'submit', revision: 1, values });
    assert.equal(second.status, 200);
    assert.deepEqual((await afterShop).readbacks, { buyer: values, shop: values });
    const replies = await Promise.all([
      api('/order', buyerCode, { type: 'approve', revision: 2 }),
      api('/order', shopCode, { type: 'approve', revision: 2 }),
    ]);
    assert.deepEqual(replies.map(({ status }) => status).sort(), [200, 409]);
    const losingCode = replies[0].status === 409 ? buyerCode : shopCode;
    const afterLock = waitForOrder(shopEvents, 4);
    const locked = await api('/order', losingCode, { type: 'approve', revision: 3 });
    assert.equal(locked.status, 200);
    assert.ok(locked.data.order.lockedAt);
    assert.equal((await afterLock).lockedAt, locked.data.order.lockedAt);
    assert.equal((await api('/order', buyerCode, { type: 'reopen', field: 'artwork', revision: 4 })).status, 409);
  } finally {
    streamController.abort();
    await Promise.allSettled(streams);
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
