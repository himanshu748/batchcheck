import { decodeMessage } from './wire.js';

export async function liveRequest(path, accessCode, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(accessCode && { Authorization: `Bearer ${accessCode}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json().catch(() => null);
  if (!result || !response.ok) {
    const error = new Error(result?.error || 'The live workspace could not be reached.');
    error.order = result?.order;
    throw error;
  }
  return result;
}

export async function openLive(accessCode, { inbox, onMessages, onStatus }) {
  const session = await liveRequest('/api/chat/session', accessCode, { inbox });
  const { order } = await liveRequest('/api/order', accessCode);
  const { connectChat } = await import('./nexconn.js');
  const decode = (messages) => messages.map((message) => decodeMessage(message, session, session.job.id)).filter(Boolean);
  const chat = await connectChat(session, {
    onMessages: (messages) => onMessages(decode(messages)),
    onStatus: ({ status }) => onStatus(status === 0 ? 'connected' : 'reconnecting'),
  });
  return { ...session, order, chat, decode };
}

export async function watchOrder(accessCode, signal, onOrder) {
  const response = await fetch('/api/order/events', {
    headers: { Authorization: `Bearer ${accessCode}` }, cache: 'no-store', signal,
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/x-ndjson') || !response.body) return;

  let partial = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop();
    for (const line of lines) {
      if (line) onOrder(JSON.parse(line));
    }
  }
}
