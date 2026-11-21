import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedValues, emptyOrder, evolveOrder, fieldStatus, orderStage, orderView, sampleOrder } from '../src/order.js';
import { decodeMessage, encodeMessage } from '../src/wire.js';

const time = '2026-11-21T10:00:00.000Z';
const values = { quantity: '80', garment: 'Natural cotton', color: 'Forest green', artwork: 'Fest artwork V2' };
const run = (order, side, action) => evolveOrder(order, side, { revision: order.revision, ...action }, time);
function change(order, side, action) {
  const result = run(order, side, action);
  assert.ok(result.order, result.error);
  return result.order;
}

test('keeps the first party’s specs hidden until both readbacks are submitted', () => {
  const no = emptyOrder('BC-0001');
  const first = change(no, 'buyer', { type: 'submit', values });
  assert.deepEqual(orderView(first, 'shop').readbacks, { shop: null, buyer: {} });
  assert.deepEqual(orderView(first, 'buyer').readbacks.buyer, values);
  const second = change(first, 'shop', { type: 'submit', values: { ...values, quantity: '60' } });
  assert.equal(orderStage(second), 'resolve');
  assert.equal(orderView(second, 'buyer').readbacks.shop.quantity, '60');
  assert.equal(fieldStatus(second, 'color'), 'match');
});

test('requires valid quantity and complete specs, and normalizes incidental differences', () => {
  const order = emptyOrder('BC-0002');
  assert.equal(run(order, 'shop', { type: 'submit', values: { ...values, quantity: '0' } }).status, 422);
  assert.equal(run(order, 'shop', { type: 'submit', values: { quantity: '60' } }).status, 422);
  const first = change(order, 'buyer', { type: 'submit', values });
  const second = change(first, 'shop', { type: 'submit', values: { ...values, color: ' forest   GREEN ', quantity: '080' } });
  assert.equal(orderStage(second), 'approve');
  assert.equal(approvedValues(second).quantity, '80');
});

test('blocks self-acceptance and superseded proposals', () => {
  const proposed = change(sampleOrder(), 'shop', { type: 'propose', field: 'quantity', value: '80' });
  const proposalId = proposed.proposals.quantity.id;
  assert.equal(run(proposed, 'shop', { type: 'accept', field: 'quantity', proposalId }).status, 409);
  const counter = change(proposed, 'buyer', { type: 'propose', field: 'quantity', value: '82' });
  assert.equal(run(counter, 'buyer', { type: 'accept', field: 'quantity', proposalId }).status, 409);
  const accepted = change(counter, 'shop', { type: 'accept', field: 'quantity', proposalId: counter.proposals.quantity.id });
  assert.equal(approvedValues(accepted).quantity, '82');
  assert.equal(orderStage(accepted), 'approve');
});

test('two approvals lock the same spec and block every later mutation', () => {
  const first = change(sampleOrder(), 'buyer', { type: 'propose', field: 'quantity', value: '80' });
  assert.equal(run(first, 'buyer', { type: 'approve' }).status, 422);
  const agreed = change(first, 'shop', { type: 'accept', field: 'quantity', proposalId: first.proposals.quantity.id });
  const shopApproved = change(agreed, 'shop', { type: 'approve' });
  assert.equal(run(shopApproved, 'shop', { type: 'approve' }).status, 422);
  assert.equal(shopApproved.lockedAt, null);
  const locked = change(shopApproved, 'buyer', { type: 'approve' });
  assert.equal(orderStage(locked), 'locked');
  assert.equal(locked.lockedAt, time);
  assert.deepEqual(locked.approvals, { shop: time, buyer: time });
  assert.equal(run(locked, 'buyer', { type: 'reopen', field: 'artwork' }).status, 409);
});

test('reopening any field invalidates previous approvals and protects against stale approval', () => {
  const proposed = change(sampleOrder(), 'shop', { type: 'propose', field: 'quantity', value: '80' });
  const accepted = change(proposed, 'buyer', { type: 'accept', field: 'quantity', proposalId: proposed.proposals.quantity.id });
  const approved = change(accepted, 'buyer', { type: 'approve' });
  const reopened = change(approved, 'shop', { type: 'reopen', field: 'artwork' });
  assert.equal(orderStage(reopened), 'resolve');
  assert.deepEqual(reopened.approvals, {});
  assert.equal(run(reopened, 'shop', { type: 'approve', revision: approved.revision }).status, 409);
  const revised = change(reopened, 'shop', { type: 'propose', field: 'artwork', value: 'Fest artwork V3' });
  const acceptedRevision = change(revised, 'buyer', { type: 'accept', field: 'artwork', proposalId: revised.proposals.artwork.id });
  assert.deepEqual(acceptedRevision.approvals, {});
  assert.equal(approvedValues(acceptedRevision).artwork, 'Fest artwork V3');
});

test('decodes Nexconn messages only for the batch and allowed field', () => {
  const session = { side: 'buyer', userId: 'buyer-id' };
  const body = {
    messageId: 'server-id', senderUserId: 'shop-id', sentTime: 10,
    content: { text: encodeMessage('BC-1042', 'quantity', 'Can we do 80?') },
  };
  assert.deepEqual(decodeMessage(body, session, 'BC-1042'), {
    id: 'server-id', side: 'shop', at: 10, field: 'quantity', text: 'Can we do 80?',
  });
  assert.equal(decodeMessage(body, session, 'other-batch'), null);
  assert.equal(decodeMessage({ ...body, content: { text: encodeMessage('BC-1042', 'constructor', 'Invalid') } }, session, 'BC-1042'), null);
});
