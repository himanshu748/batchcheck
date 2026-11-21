import {
  AreaCode,
  BaseChannel,
  ConnectionStatusHandler,
  DirectChannel,
  MessageHandler,
  NCEngine,
  SendTextMessageParams,
} from '@nexconn/chat';

const areas = { sg: AreaCode.SG, us: AreaCode.NA };
let appKey;
let active = false;

export async function connectChat(session, { onMessages, onStatus }) {
  if (active) throw new Error('Close the current chat session before opening another.');
  if (appKey && appKey !== session.appKey) throw new Error('Reload to switch to a different Nexconn app.');
  if (!Object.hasOwn(areas, session.region)) throw new Error('Unsupported Nexconn chat region.');

  if (!appKey) {
    NCEngine.initialize({ appKey: session.appKey, areaCode: areas[session.region] });
    appKey = session.appKey;
  }

  const channel = new DirectChannel(session.peerId);
  const handlerId = crypto.randomUUID();
  active = true;
  let closing;

  const matchesChannel = (message) => channel.identifier.isEqualTo(message.channelIdentifier)
    && [session.userId, session.peerId].includes(message.senderUserId);

  async function disconnect() {
    NCEngine.removeMessageHandler(handlerId);
    NCEngine.removeConnectionStatusHandler(handlerId);
    try {
      await NCEngine.disconnect();
    } finally {
      active = false;
    }
  }

  try {
    NCEngine.addMessageHandler(handlerId, new MessageHandler({
      onMessageReceived({ messages }) {
        const relevant = messages.filter(matchesChannel);
        if (relevant.length) onMessages?.(relevant);
      },
    }));
    NCEngine.addConnectionStatusHandler(handlerId, new ConnectionStatusHandler({
      onConnectionStatusChanged: onStatus,
    }));

    const result = await NCEngine.connect({ token: session.token });
    if (!result.isOk || result.data?.userId !== session.userId) {
      throw new Error(`Nexconn could not connect the chat session (${result.code}).`);
    }
  } catch (error) {
    await disconnect().catch(() => {});
    throw error;
  }

  return {
    async send(text) {
      if (closing) throw new Error('This chat session has closed.');
      const result = await channel.sendMessage(new SendTextMessageParams({ text }));
      if (!result.isOk || !result.data) throw new Error(`Message could not be sent (${result.code}).`);
      return result.data;
    },
    async history(startTime = Date.now()) {
      if (closing) throw new Error('This chat session has closed.');
      const query = BaseChannel.createMessagesQuery({ channelIdentifier: channel.identifier, pageSize: 50, startTime });
      const result = await query.loadNextPage();
      if (!result.isOk || !result.data) throw new Error(`Chat history could not be loaded (${result.code}).`);
      return { messages: result.data.data.filter(matchesChannel), hasNext: query.hasNext };
    },
    close() {
      closing ??= disconnect();
      return closing;
    },
  };
}
