import { fields, otherSide } from './order.js';

const PREFIX = 'batchcheck.chat.v1:';

export function encodeMessage(orderId, field, text) {
  return PREFIX + JSON.stringify({ orderId, field, text });
}

export function decodeMessage(message, session, orderId) {
  const payload = message.content?.text;
  if (typeof payload !== 'string' || !payload.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(payload.slice(PREFIX.length));
    if (!Object.hasOwn(fields, value.field) || value.orderId !== orderId || typeof value.text !== 'string'
      || value.text.length > 500 || !message.messageId || !Number.isFinite(message.sentTime)) return null;
    return {
      id: message.messageId,
      field: value.field,
      side: message.senderUserId === session.userId ? session.side : otherSide(session.side),
      at: message.sentTime,
      text: value.text,
    };
  } catch {
    return null;
  }
}
