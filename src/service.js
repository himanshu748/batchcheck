import { parties } from './order.js';

const regions = { sg: 'api.sg-light-api.com', us: 'api.us-light-api.com' };
const encoder = new TextEncoder();
const accessChallenge = encoder.encode('BatchCheck access code');

export function serviceConfig(env) {
  const { NEXCONN_APP_KEY: appKey, NEXCONN_APP_SECRET: appSecret } = env;
  const region = env.NEXCONN_REGION ?? 'sg';
  const apiHost = Object.hasOwn(regions, region) ? regions[region] : null;
  const job = {
    id: env.BATCH_ID || 'BC-1042',
    title: env.BATCH_TITLE || 'Campus Fest tees',
    buyer: env.BATCH_BUYER || parties.buyer.name,
    shop: env.BATCH_SHOP || parties.shop.name,
  };
  const roles = {
    buyer: { userId: env.NEXCONN_BUYER_ID, code: env.BUYER_ACCESS_CODE, name: job.buyer },
    shop: { userId: env.NEXCONN_SHOP_ID, code: env.SHOP_ACCESS_CODE, name: job.shop },
  };
  const configured = Boolean(appKey && appSecret && apiHost && Object.values(roles).every(
    ({ userId, code, name }) => /^[A-Za-z0-9]{16,64}$/.test(userId ?? '')
      && /^[A-Za-z0-9_-]{24,120}$/.test(code ?? '') && name.length <= 64,
  ) && roles.buyer.userId !== roles.shop.userId && roles.buyer.code !== roles.shop.code);
  return { appKey, appSecret, region, apiHost, job, roles, configured };
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function issueNexconnToken({ apiHost, appKey, appSecret }, user) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(8)));
  const timestamp = Date.now().toString();
  const signature = hex(new Uint8Array(await crypto.subtle.digest('SHA-1', encoder.encode(appSecret + nonce + timestamp))));
  const response = await fetch(`https://${apiHost}/v4/auth/access-token/issue`, {
    method: 'POST',
    headers: {
      'App-Key': appKey, Nonce: nonce, Timestamp: timestamp, Signature: signature,
      'X-Request-ID': crypto.randomUUID(), 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId: user.userId, name: user.name }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nexconn HTTP ${response.status}`);
  const { code, result } = await response.json();
  if (code !== 0 || result?.userId !== user.userId || typeof result.accessToken !== 'string' || !result.accessToken) {
    throw new Error('Nexconn refused the chat token.');
  }
  return result.accessToken;
}

export function bearerCode(authorization) {
  return authorization?.match(/^Bearer ([A-Za-z0-9_-]{24,120})$/)?.[1];
}

function hmacKey(code, usage) {
  return crypto.subtle.importKey('raw', encoder.encode(code), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function authenticateCode(authorization, roles) {
  const supplied = bearerCode(authorization);
  if (!supplied) return null;
  const tag = await crypto.subtle.sign('HMAC', await hmacKey(supplied, 'sign'), accessChallenge);
  const [buyer, shop] = await Promise.all(Object.values(roles).map(
    async ({ code }) => crypto.subtle.verify('HMAC', await hmacKey(code, 'verify'), tag, accessChallenge),
  ));
  return buyer ? 'buyer' : shop ? 'shop' : null;
}
