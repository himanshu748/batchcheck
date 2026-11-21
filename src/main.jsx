import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, CircleCheck, Clipboard, Download, LockKeyhole, LogOut,
  MessageSquare, RotateCcw, Send, TriangleAlert, X,
} from 'lucide-react';
import {
  approvedValues, evolveOrder, fieldKeys, fields, fieldStatus, formatValue, orderStage, otherSide, parties,
} from './order.js';
import { getDemo, resetDemo, subscribeDemo, writeDemoMessage, writeDemoOrder } from './demo.js';
import { liveRequest, openLive, watchOrder } from './live.js';
import { encodeMessage } from './wire.js';
import { Brand } from './brand.jsx';
import './styles.css';

const sampleJob = { title: 'Campus Fest tees', buyer: parties.buyer.name, shop: parties.shop.name };
const timeLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const requestedInbox = new URLSearchParams(location.search).get('inbox');
const inbox = Object.hasOwn(parties, requestedInbox) ? requestedInbox : undefined;
const inboxHref = (role) => `/workspace/?inbox=${role}`;

function Status({ kind, children }) {
  return <span className={`status status-${kind}`}>
    {kind === 'warning' ? <TriangleAlert size={15} /> : <span className="status-dot" />}
    {children}
  </span>;
}

function Progress({ stage }) {
  const steps = ['readback', 'resolve', 'approve'];
  const index = stage === 'locked' ? steps.length : steps.indexOf(stage);
  return <ol className="progress" aria-label="Order progress">
    {steps.map((step, position) => (
      <li key={step} className={position < index ? 'done' : position === index ? 'current' : ''}
        aria-current={position === index ? 'step' : undefined}>
        <span className="step-index">{position < index ? <Check size={20} strokeWidth={3} /> : position + 1}</span>
        <span>{step}</span>
      </li>
    ))}
  </ol>;
}

function MismatchStrip({ order, side, field, count, reviewField }) {
  const label = fields[field].label;
  const reopened = order.reopened[field];
  const proposal = order.proposals[field];
  const awaitingYou = proposal && proposal.side !== side;
  return <section className="mismatch-strip" aria-labelledby="mismatch-title">
    <div className="mismatch-title">
      <span className="mismatch-icon"><TriangleAlert size={19} aria-hidden="true" /></span>
      <div><h2 id="mismatch-title">{label} {reopened ? 'reopened' : 'mismatch'}</h2>
        <p>{count > 1 ? `${count} fields need review.` : awaitingYou ? 'A proposed correction is ready to review.' : 'Agree on the value before production.'}</p></div>
    </div>
    <dl className={`mismatch-values ${field === 'quantity' ? 'is-quantity' : ''}`}>
      {Object.keys(parties).map((party) => <div key={party}>
        <dt>{parties[party].label}</dt>
        <dd>{field === 'quantity' ? Number(order.readbacks[party][field]).toLocaleString('en-IN')
          : formatValue(field, order.readbacks[party][field])}</dd>
      </div>)}
    </dl>
    <button className="button primary" onClick={() => reviewField(field)}>
      {awaitingYou ? 'Review proposal' : 'Propose a fix'} <ArrowRight size={18} aria-hidden="true" />
    </button>
  </section>;
}

function SpecInput({ field, value, onChange, id, ...props }) {
  return <input
    {...props}
    id={id}
    type="text"
    inputMode={field === 'quantity' ? 'numeric' : 'text'}
    pattern={field === 'quantity' ? '[0-9]{1,5}' : undefined}
    maxLength={field === 'quantity' ? 5 : 80}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    placeholder={fields[field].placeholder}
    required
  />;
}

function Readback({ order, side, busy, mutate }) {
  const [draft, setDraft] = useState({ quantity: '', garment: '', color: '', artwork: '' });
  return <section className="panel readback">
    <div className="panel-heading">
      <h2>Your readback</h2>
      <p>Enter what you believe the order calls for. Both sets of specs appear after both parties submit.</p>
    </div>
    {order.readbacks[side] ? <>
      <div className="notice green"><CircleCheck size={22} /><div><strong>Readback submitted</strong><p>Waiting for the {parties[otherSide(side)].label.toLowerCase()}.</p></div></div>
      <dl className="receipt-details">{fieldKeys.map((field) => <div key={field}>
        <dt>{fields[field].label}</dt><dd>{formatValue(field, order.readbacks[side][field])}</dd>
      </div>)}</dl>
    </> : <form className="readback-form" onSubmit={(event) => { event.preventDefault(); void mutate({ type: 'submit', values: draft }); }}>
      <div className="input-grid">{fieldKeys.map((field) => <label key={field} htmlFor={`readback-${field}`}>
        {fields[field].label}
        <SpecInput id={`readback-${field}`} field={field} value={draft[field]} onChange={(next) => setDraft({ ...draft, [field]: next })} />
      </label>)}</div>
      <button className="button primary" disabled={busy}>Submit readback <ArrowRight size={17} /></button>
    </form>}
  </section>;
}

function SpecTable({ order, selected, setSelected }) {
  return <table className="spec-table">
    <thead><tr><th scope="col">Field</th><th scope="col">Buyer</th><th scope="col">Print shop</th><th scope="col">Status</th></tr></thead>
    <tbody>{fieldKeys.map((field) => {
      const status = fieldStatus(order, field);
      const agreement = order.agreements[field];
      return <tr key={field} className={`${status} ${selected === field ? 'selected' : ''}`}>
        <th scope="row">{setSelected ? <button className="field-button" type="button" onClick={() => setSelected(field)}
          aria-pressed={selected === field}>{fields[field].label}</button> : fields[field].label}</th>
        <td>{formatValue(field, agreement ?? order.readbacks.buyer[field])}</td>
        <td>{formatValue(field, agreement ?? order.readbacks.shop[field])}</td>
        <td><Status kind={status === 'review' ? 'warning' : 'success'}>{status === 'review' ? 'Review' : status === 'resolved' ? 'Agreed' : 'Match'}</Status></td>
      </tr>;
    })}</tbody>
  </table>;
}

function Comparison({ order, stage, side, selected, setSelected, busy, mutate }) {
  return <section className="panel comparison" aria-labelledby="spec-title">
    <div className="panel-heading">
      <h2 id="spec-title">Order specs</h2>
      <p>Side-by-side readbacks</p>
    </div>
    <SpecTable order={order} selected={stage === 'locked' ? null : selected} setSelected={stage === 'locked' ? null : setSelected} />
    {stage === 'approve' && <div className="approval">
      <div className="approval-parties">{Object.keys(parties).map((party) => <span key={party}
        className={order.approvals[party] ? 'approved' : ''}>
        {order.approvals[party] ? <CircleCheck size={17} /> : <span className="hollow-dot" />}
        {parties[party].label} {order.approvals[party] ? 'approved' : 'pending'}
      </span>)}</div>
      <div className="comparison-footer">
        <LockKeyhole size={22} />
        <p>{order.approvals[side] ? 'Waiting for the other party to approve.' : 'Both parties must approve the same specs before the batch locks.'}</p>
        {!order.approvals[side] && <button className="button primary compact" disabled={busy}
          onClick={() => void mutate({ type: 'approve' })}><Check size={16} /> Approve batch</button>}
      </div>
    </div>}
    {stage === 'locked' && <div className="comparison-footer green-text">
      <CircleCheck size={23} /><p><strong>Ready for production.</strong> Both parties approved these specs.</p>
    </div>}
  </section>;
}

function InboxThreads({ order, side, field, messages, selectField }) {
  const title = `${parties[side].label} inbox`;
  return <nav className="inbox-threads" aria-label={title}>
    <span className="inbox-title"><MessageSquare size={15} aria-hidden="true" /> {title}</span>
    <div className="inbox-fields">
      {fieldKeys.map((key) => {
        const count = messages.filter((message) => message.field === key).length;
        const needsReply = order.proposals[key] && order.proposals[key].side !== side;
        const activity = needsReply ? 'needs your reply' : count > 0 ? `${count} ${count === 1 ? 'message' : 'messages'}` : null;
        return <button key={key} type="button" aria-pressed={field === key}
          aria-label={activity ? `${fields[key].label}, ${activity}` : undefined} onClick={() => selectField(key)}>
          {fields[key].label}
          {needsReply ? <span className="inbox-reply" aria-hidden="true">Reply</span> : count > 0 && <span className="inbox-count" aria-hidden="true">{count}</span>}
        </button>;
      })}
    </div>
  </nav>;
}

function Thread({ order, side, field, job, messages, busy, canSend, mutate, send, proposalInput, acceptButton }) {
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState(() => order.agreements[field] ?? order.readbacks.buyer[field]);
  const [isSending, setIsSending] = useState(false);
  const history = useRef(null);
  const proposal = order.proposals[field];
  const status = fieldStatus(order, field);
  const notes = messages.filter((message) => message.field === field);
  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [notes.length]);

  async function handleMessage(event) {
    event.preventDefault();
    if (!input.trim() || isSending) return;
    setIsSending(true);
    try {
      await send(field, input.trim());
      setInput('');
    } catch {
      // The workspace shows the error and the text remains available for retry.
    } finally {
      setIsSending(false);
    }
  }

  return <>
    <div className="panel-heading">
      <h2 id="thread-title">{fields[field].label} thread</h2>
      <p>Resolution chat</p>
    </div>
    <div className="messages" ref={history} role="log" aria-label={`${fields[field].label} messages`}>
      {notes.length ? notes.map((message) => <article className="message" key={message.id}>
        <span className={`avatar avatar-${message.side}`} aria-hidden="true">{parties[message.side].initials}</span>
        <div>
          <header><strong>{job[message.side]}</strong><time dateTime={new Date(message.at).toISOString()}>{timeLabel.format(message.at)}</time></header>
          <p>{message.text}</p>
        </div>
      </article>) : <div className="empty-thread"><MessageSquare size={23} /><p>Use this thread to clarify {fields[field].label.toLowerCase()}.</p></div>}
    </div>
    {status === 'review' ? <>
      {proposal && <div className="pending-proposal">
        <div><span>{job[proposal.side]} proposed</span><strong>{formatValue(field, proposal.value)}</strong></div>
        {proposal.side === side ? <Status kind="neutral">Awaiting reply</Status> : <button className="button primary compact" ref={acceptButton}
          disabled={busy} onClick={() => void mutate({ type: 'accept', field, proposalId: proposal.id })}><Check size={17} /> Accept</button>}
      </div>}
      <form className="proposal" onSubmit={(event) => {
        event.preventDefault();
        void mutate({ type: 'propose', field, value: draft });
      }}>
        <label htmlFor="proposal-value">{proposal ? 'Counterproposal' : `Propose ${field === 'artwork' ? 'artwork' : `a ${fields[field].label.toLowerCase()}`}`}</label>
        <SpecInput id="proposal-value" ref={proposalInput} field={field} value={draft} onChange={setDraft} />
        <button className="button primary compact" disabled={busy}>Send proposal</button>
      </form>
    </> : <div className="proposal quiet">
      <span><Check size={18} /> {status === 'resolved' ? 'Agreed' : 'Entries match'}</span>
      <button className="button text-button" disabled={busy}
        onClick={() => void mutate({ type: 'reopen', field })}><RotateCcw size={15} /> Reopen field</button>
    </div>}
    <form className="composer" onSubmit={handleMessage}>
      <input aria-label={`Message about ${fields[field].label.toLowerCase()}`} placeholder="Type a message…"
        maxLength={500} value={input} onChange={(event) => setInput(event.target.value)} />
      <button className="button text-button icon-button" aria-label="Send message" title="Send message" disabled={!canSend || isSending || !input.trim()}><Send size={18} /></button>
    </form>
  </>;
}

function Receipt({ order, job }) {
  const values = approvedValues(order);
  const corrections = fieldKeys.filter((field) => order.agreements[field] && Object.keys(parties).some(
    (side) => order.readbacks[side][field] !== values[field],
  )).map((field) => ({
    field,
    original: Object.keys(parties).map((side) => `${parties[side].label} ${formatValue(field, order.readbacks[side][field])}`).join(' · '),
  }));
  function download() {
    const text = [
      'BatchCheck production receipt', `Batch ${order.id}: ${job.title}`,
      ...fieldKeys.map((field) => `${fields[field].label}: ${formatValue(field, values[field])}`),
      ...corrections.map(({ field, original }) => `${fields[field].label} readbacks: ${original}`),
      ...Object.keys(parties).map((side) => `${job[side]} approved at ${order.approvals[side]}`),
      `Locked at ${order.lockedAt}`,
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `batchcheck-${order.id}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel receipt">
    <div className="panel-heading"><h2>Production receipt</h2><p>Batch {order.id} · {dateLabel.format(new Date(order.lockedAt))}</p></div>
    <dl className="receipt-details">{fieldKeys.map((field) => <div key={field}>
      <dt>{fields[field].label}</dt><dd>{formatValue(field, values[field])}</dd>
    </div>)}</dl>
    {corrections.length > 0 && <div className="receipt-corrections">
      <h3>Original readbacks</h3>
      <dl>{corrections.map(({ field, original }) => <div key={field}>
        <dt>{fields[field].label}</dt><dd>{original}</dd>
      </div>)}</dl>
    </div>}
    <div className="receipt-signoffs">{Object.keys(parties).map((side) => <div key={side}>
      <CircleCheck size={18} /><span><strong>{job[side]}</strong><time dateTime={order.approvals[side]}>{dateLabel.format(new Date(order.approvals[side]))}</time></span>
    </div>)}</div>
    <button className="button primary" onClick={download}><Download size={17} /> Download receipt</button>
  </section>;
}

function LiveDialog({ dialog, pending, error, enterLive }) {
  const [code, setCode] = useState('');
  return <dialog ref={dialog} className="dialog" onClose={() => setCode('')} onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void enterLive(code.trim()); }}>
      <div className="dialog-heading">
        <h2>Join live workspace</h2>
        <button type="button" className="button text-button icon-button" disabled={pending} onClick={() => dialog.current.close()} aria-label="Close"><X size={21} /></button>
      </div>
      <p>{inbox ? `Use the access code for the ${parties[inbox].label.toLowerCase()} inbox.` : 'Use the access code for your buyer or print shop role.'}</p>
      <label htmlFor="access-code">Workspace access code
        <input id="access-code" type="password" autoComplete="off" value={code} maxLength={120} required
          onChange={(event) => setCode(event.target.value)} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" disabled={pending}>{pending ? 'Connecting…' : 'Join workspace'} <ArrowRight size={16} /></button>
    </form>
  </dialog>;
}

function App() {
  const [demo, setDemo] = useState(getDemo);
  const [live, setLive] = useState(null);
  const [liveOrder, setLiveOrder] = useState(null);
  const [liveMessages, setLiveMessages] = useState([]);
  const [connection, setConnection] = useState('reconnecting');
  const [orderReachable, setOrderReachable] = useState(true);
  const [error, setError] = useState('');
  const [liveError, setLiveError] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('quantity');
  const [replay, setReplay] = useState(0);
  const dialog = useRef(null);
  const menu = useRef(null);
  const proposalInput = useRef(null);
  const acceptButton = useRef(null);
  const activeOrder = useRef(null);
  const mutation = useRef(false);
  const order = live ? liveOrder : demo.order;
  const side = live?.side ?? inbox ?? 'shop';
  const job = live?.job ?? sampleJob;
  const messages = live ? liveMessages : demo.messages;
  const stage = orderStage(order);
  const mismatches = fieldKeys.filter((field) => fieldStatus(order, field) === 'review');
  const activeMismatch = mismatches.includes(selected) ? selected : mismatches[0];

  useEffect(() => subscribeDemo(() => setDemo(getDemo())), []);
  useEffect(() => { document.title = `${parties[side].label} inbox | BatchCheck`; }, [side]);

  function mergeMessages(batch) {
    setLiveMessages((current) => Array.from(new Map(
      [...current, ...batch].map((message) => [message.id, message]),
    ).values()).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)));
  }

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    let nextPoll;
    let streaming = false;
    const receive = (latest) => {
      if (controller.signal.aborted) return;
      setOrderReachable(true);
      setLiveOrder((current) => latest.revision >= current.revision ? latest : current);
    };
    const refresh = async () => {
      nextPoll = undefined;
      try {
        const { order: latest } = await liveRequest('/api/order', live.accessCode);
        receive(latest);
      } catch {
        if (!controller.signal.aborted && !streaming) setOrderReachable(false);
      }
      if (!controller.signal.aborted) nextPoll = setTimeout(refresh, streaming ? 15_000 : document.hidden ? 5000 : 1400);
    };
    watchOrder(live.accessCode, controller.signal, (latest) => {
      streaming = true;
      receive(latest);
    }).catch(() => {}).finally(() => {
      if (controller.signal.aborted) return;
      streaming = false;
      if (nextPoll) {
        clearTimeout(nextPoll);
        nextPoll = setTimeout(refresh, 100);
      }
    });
    void refresh();
    return () => { controller.abort(); clearTimeout(nextPoll); };
  }, [live]);

  useEffect(() => {
    if (!live || connection !== 'connected') return;
    let cancelled = false;
    live.chat.history().then(({ messages: batch }) => {
      if (!cancelled) mergeMessages(live.decode(batch));
    }).catch(() => {
      if (!cancelled) setError('Recent messages could not be loaded. New messages can still arrive.');
    });
    return () => { cancelled = true; };
  }, [live, connection]);

  async function enterLive(accessCode) {
    if (joining) return;
    setJoining(true);
    setLiveError('');
    setConnection('reconnecting');
    setLiveMessages([]);
    try {
      const session = await openLive(accessCode, { inbox, onMessages: mergeMessages, onStatus: setConnection });
      activeOrder.current = session.job.id;
      setLiveOrder(session.order);
      setLive({ ...session, accessCode });
      setConnection('connected');
      setOrderReachable(true);
      setError('');
      dialog.current.close();
    } catch (failure) {
      setLiveError(location.protocol === 'file:' ? 'Start the BatchCheck server to join a live workspace.' : failure.message);
    } finally {
      setJoining(false);
    }
  }

  async function exitLive() {
    try {
      await live.chat.close();
    } finally {
      activeOrder.current = null;
      setLive(null);
      setLiveMessages([]);
      setError('');
    }
  }

  async function mutate(action) {
    if (mutation.current) return false;
    mutation.current = true;
    setBusy(true);
    setError('');
    const command = { ...action, revision: order.revision };
    try {
      if (live) {
        const { order: updated } = await liveRequest('/api/order', live.accessCode, command);
        if (activeOrder.current === updated.id) setLiveOrder((current) => updated.revision >= current.revision ? updated : current);
      } else {
        const result = await writeDemoOrder((current) => evolveOrder(current, side, command, new Date().toISOString()));
        if (result.error) throw new Error(result.error);
        setDemo(result);
      }
      return true;
    } catch (failure) {
      if (live && failure.order && activeOrder.current === failure.order.id) {
        setLiveOrder((current) => failure.order.revision >= current.revision ? failure.order : current);
      }
      setError(failure.message);
      return false;
    } finally {
      setBusy(false);
      mutation.current = false;
    }
  }

  async function send(field, text) {
    setError('');
    try {
      if (live) {
        const result = await live.chat.send(encodeMessage(order.id, field, text));
        if (activeOrder.current === order.id) mergeMessages(live.decode([result]));
      } else {
        await writeDemoMessage({ id: crypto.randomUUID(), field, side, text, at: Date.now() });
      }
    } catch (failure) {
      setError(failure.message);
      throw failure;
    }
  }

  async function replayDemo(sample) {
    await resetDemo(sample);
    setReplay((current) => current + 1);
    setSelected('quantity');
    setError('');
    menu.current.open = false;
  }

  const selectField = (field) => { setSelected(field); setError(''); };
  function reviewField(field) {
    selectField(field);
    requestAnimationFrame(() => {
      const target = acceptButton.current ?? proposalInput.current;
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    });
  }

  return <>
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <div className="topbar-actions">
          {live ? <>
            <span className="workspace-label"><span className={`connection-dot ${connection}`} />Live · {parties[side].label} inbox</span>
            <button className="button secondary compact" onClick={() => void exitLive().catch(() => {})}><LogOut size={16} /> Leave</button>
          </> : <>
            <details ref={menu} className="workspace-menu" onKeyDown={(event) => { if (event.key === 'Escape') menu.current.open = false; }}>
              <summary className="workspace-label"><span className="connection-dot connected" />Demo workspace <ChevronDown size={16} /></summary>
              <div className="workspace-popover">
                <p>Try both sides of a sample order.</p>
                <button onClick={() => void replayDemo(false)}><Clipboard size={16} /> Start blank readback</button>
                <button onClick={() => void replayDemo(true)}><RotateCcw size={16} /> Reset sample</button>
              </div>
            </details>
            <nav className="role-control" aria-label="Demo inboxes">
              {Object.keys(parties).map((role) => <a key={role} href={inboxHref(role)} aria-current={side === role ? 'page' : undefined}>
                {parties[role].label}
              </a>)}
            </nav>
            <button className="button dark compact" onClick={() => { menu.current.open = false; setLiveError(''); dialog.current.showModal(); }}>Go live</button>
          </>}
        </div>
      </div>
    </header>

    <main className="workspace">
      <div className="order-heading">
        <div>
          <span className="job-id">{order.id}</span>
          <h1>{job.title}</h1>
          <p>{job.shop} <span aria-hidden="true">×</span> {job.buyer}</p>
        </div>
        <Progress stage={stage} />
      </div>

      {stage === 'resolve' && <MismatchStrip order={order} field={activeMismatch} count={mismatches.length} side={side} reviewField={reviewField} />}

      {error && <div className="notice warning" role="alert"><TriangleAlert size={18} /><p>{error}</p>
        <button className="button icon-button text-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}
      {live && (!orderReachable || connection !== 'connected') && <div className="notice warning" role="status">
        <TriangleAlert size={18} /><p>{!orderReachable ? 'Reconnecting to the order workspace…' : 'Reconnecting to Nexconn chat…'}</p>
      </div>}

      {stage === 'readback' ? <Readback key={`${side}-${replay}`} order={order} side={side} busy={busy} mutate={mutate} />
        : <div className="workgrid">
          <Comparison order={order} stage={stage} side={side} selected={selected} setSelected={selectField}
            busy={busy} mutate={mutate} />
          {stage === 'locked' ? <Receipt order={order} job={job} />
            : <section className="panel thread" aria-labelledby="thread-title">
              <InboxThreads order={order} side={side} field={selected} messages={messages} selectField={selectField} />
              <Thread key={`${selected}-${side}-${replay}`} order={order} field={selected} side={side} job={job} messages={messages}
                busy={busy} canSend={!live || connection === 'connected'} mutate={mutate} send={send}
                proposalInput={proposalInput} acceptButton={acceptButton} />
            </section>}
        </div>}

      <footer className="workspace-footer">
        {live ? <p><span className={`connection-dot ${connection}`} /> Nexconn Chat SDK</p>
          : <>
            <p>Sample order · Both inboxes sync in this browser</p>
            <a className="open-other-inbox" href={inboxHref(otherSide(side))} target="_blank" rel="noopener">
              Open {parties[otherSide(side)].label.toLowerCase()} inbox <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </>}
      </footer>
    </main>
    <LiveDialog dialog={dialog} pending={joining} error={liveError} enterLive={enterLive} />
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
