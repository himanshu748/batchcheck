export const parties = {
  buyer: { label: 'Buyer', name: 'Campus Arts Club', initials: 'CA' },
  shop: { label: 'Print shop', name: 'Northline Print', initials: 'NP' },
};

export const fields = {
  quantity: { label: 'Quantity', placeholder: '80' },
  garment: { label: 'Garment', placeholder: 'Natural cotton' },
  color: { label: 'Print color', placeholder: 'Forest green' },
  artwork: { label: 'Artwork', placeholder: 'Fest artwork V2' },
};

export const fieldKeys = Object.keys(fields);
export const otherSide = (side) => side === 'buyer' ? 'shop' : 'buyer';

export function emptyOrder(id) {
  return {
    id,
    revision: 0,
    readbacks: {},
    agreements: {},
    proposals: {},
    reopened: {},
    approvals: {},
    lockedAt: null,
  };
}

export function sampleOrder() {
  const base = { garment: 'Natural cotton', color: 'Forest green', artwork: 'Fest artwork V2' };
  return {
    ...emptyOrder('BC-1042'),
    revision: 2,
    readbacks: { buyer: { ...base, quantity: '80' }, shop: { ...base, quantity: '60' } },
  };
}

export function parseValue(field, input) {
  if (typeof input !== 'string' || !Object.hasOwn(fields, field)) return null;
  const value = input.trim().replace(/\s+/gu, ' ').normalize('NFC');
  if (field === 'quantity') {
    if (!/^\d{1,5}$/.test(value) || Number(value) < 1) return null;
    return String(Number(value));
  }
  return value && value.length <= 80 ? value : null;
}

function equalValues(first, second) {
  return first.toLocaleLowerCase('en') === second.toLocaleLowerCase('en');
}

export function formatValue(field, value) {
  if (!value) return 'Awaiting entry';
  if (field === 'quantity') return `${Number(value).toLocaleString('en-IN')} ${value === '1' ? 'shirt' : 'shirts'}`;
  return value;
}

export function fieldStatus(order, field) {
  const { buyer, shop } = order.readbacks;
  if (!buyer || !shop) return 'pending';
  if (order.agreements[field]) return 'resolved';
  return order.reopened[field] || !equalValues(buyer[field], shop[field]) ? 'review' : 'match';
}

export function orderStage(order) {
  if (order.lockedAt !== null) return 'locked';
  if (!order.readbacks.buyer || !order.readbacks.shop) return 'readback';
  return fieldKeys.some((field) => fieldStatus(order, field) === 'review') ? 'resolve' : 'approve';
}

export function orderView(order, side) {
  if (order.readbacks.buyer && order.readbacks.shop) return order;
  // Suppress the other party's entries at the source until both are submitted.
  return {
    ...order,
    readbacks: {
      [side]: order.readbacks[side] ?? null,
      [otherSide(side)]: order.readbacks[otherSide(side)] ? {} : null,
    },
  };
}

export function approvedValues(order) {
  return Object.fromEntries(fieldKeys.map((field) => [
    field, order.agreements[field] ?? order.readbacks.buyer?.[field],
  ]));
}

export function evolveOrder(order, side, action, now) {
  const fail = (error, status = 422) => ({ error, status });
  if (!Object.hasOwn(parties, side)) return fail('Choose a valid role.');
  if (action?.revision !== order.revision) return fail('The order changed. Review the latest version and try again.', 409);
  if (order.lockedAt !== null) return fail('Both sides approved. This batch is locked.', 409);

  const stage = orderStage(order);
  const next = structuredClone(order);
  next.revision += 1;

  if (action.type === 'submit') {
    if (stage !== 'readback' || order.readbacks[side]) return fail('Your readback is already submitted.');
    const values = Object.fromEntries(fieldKeys.map((field) => [field, parseValue(field, action.values?.[field])]));
    if (fieldKeys.some((field) => values[field] === null)) return fail('Enter a valid quantity and all three specifications.');
    next.readbacks[side] = values;
    return { order: next };
  }

  if (action.type === 'approve') {
    if (stage !== 'approve') return fail('Resolve every open field before approving.');
    if (order.approvals[side]) return fail('You have already approved this version.');
    next.approvals[side] = now;
    if (next.approvals[otherSide(side)]) next.lockedAt = now;
    return { order: next };
  }

  if (!Object.hasOwn(fields, action.field) || stage === 'readback') return fail('That field is unavailable.');
  const field = action.field;
  const needsReview = fieldStatus(order, field) === 'review';

  switch (action.type) {
    case 'propose': {
      if (!needsReview) return fail('Reopen this field to propose a change.');
      const value = parseValue(field, action.value);
      if (value === null) return fail(`Enter a valid ${fields[field].label.toLowerCase()}.`);
      next.proposals[field] = { value, side, id: next.revision, at: now };
      break;
    }
    case 'accept': {
      const proposal = order.proposals[field];
      if (!needsReview || !proposal || proposal.side === side || proposal.id !== action.proposalId) {
        return fail('This proposal cannot be accepted. Check that it is still current.', 409);
      }
      next.agreements[field] = proposal.value;
      delete next.proposals[field];
      delete next.reopened[field];
      break;
    }
    case 'reopen': {
      if (needsReview) return fail('This field is already under review.');
      next.reopened[field] = true;
      delete next.agreements[field];
      break;
    }
    default:
      return fail('Unknown order action.');
  }

  next.approvals = {};
  return { order: next };
}
