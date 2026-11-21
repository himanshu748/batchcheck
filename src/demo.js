import { emptyOrder, sampleOrder } from './order.js';

const KEY = 'batchcheck-demo-v1';
const notification = 'batchcheck:demo';
const initialTime = Date.now();

function seedMessages() {
  const notes = [
    ['buyer', 'We need 80 for volunteers and performers.'],
    ['shop', 'Our print sheet says 60. Let me check the run with production.'],
    ['buyer', 'Thanks. Please send 80 as the updated quantity when confirmed.'],
  ];
  return notes.map(([side, text], index) => ({
    id: `sample-${index}`, field: 'quantity', side, text, at: initialTime - (3 - index) * 60_000,
  }));
}

let fallback;

export function getDemo() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Local storage can be disabled in a preview iframe.
  }
  fallback ??= { order: sampleOrder(), messages: seedMessages() };
  return fallback;
}

function updateDemo(change) {
  const run = () => {
    const result = change(getDemo());
    if (result.error) return result;
    fallback = result;
    try {
      localStorage.setItem(KEY, JSON.stringify(result));
    } catch {
      // The current tab can still run the demo.
    }
    window.dispatchEvent(new Event(notification));
    return result;
  };
  return navigator.locks?.request(KEY, run) ?? Promise.resolve(run());
}

export function subscribeDemo(listener) {
  const onStorage = (event) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener(notification, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(notification, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function resetDemo(sample) {
  return updateDemo(() => ({
    order: sample ? sampleOrder() : emptyOrder('BC-1042'),
    messages: sample ? seedMessages() : [],
  }));
}

export function writeDemoOrder(reduce) {
  return updateDemo((demo) => {
    const result = reduce(demo.order);
    return result.error ? result : { ...demo, order: result.order };
  });
}

export function writeDemoMessage(message) {
  return updateDemo((demo) => ({ ...demo, messages: [...demo.messages, message].slice(-300) }));
}
