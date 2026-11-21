import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, RotateCcw } from 'lucide-react';
import { Brand } from './brand.jsx';
import { sampleOrder } from './order.js';
import './styles.css';
import './home.css';

const steps = [
  {
    title: 'Compare readbacks',
    detail: 'The buyer and printer enter what they expect to produce. Both see the specs once they submit.',
  },
  {
    title: 'Resolve the mismatch',
    detail: 'Discuss the discrepancy in its own chat and agree on a correction.',
  },
  {
    title: 'Approve the batch',
    detail: 'Both sides sign off on the same specs and get a production receipt.',
  },
];

const sample = sampleOrder();

function SamplePreview() {
  const [fixed, setFixed] = useState(false);
  return <section className="sample-preview" aria-label="Interactive sample order">
    <div className="sample-preview-header">
      <div><h2>Campus Fest tees</h2><p>{sample.id} · Sample order</p></div>
      <span className={`sample-indicator ${fixed ? 'is-fixed' : ''}`} aria-hidden="true" />
    </div>
    <dl className="sample-counts" aria-label="Quantity comparison">
      <div><dt>Buyer</dt><dd>{sample.readbacks.buyer.quantity}{' '}<span>shirts</span></dd></div>
      <div className={fixed ? 'corrected' : 'disputed'}><dt>Print shop</dt>
        <dd>{fixed ? sample.readbacks.buyer.quantity : sample.readbacks.shop.quantity}{' '}<span>shirts</span></dd>
      </div>
    </dl>
    <div className="sample-preview-footer">
      <p aria-live="polite">{fixed ? <><Check size={19} aria-hidden="true" /> Quantities agree</> : 'Quantity mismatch'}</p>
      {fixed ? <button className="button sample-reset" type="button" onClick={() => setFixed(false)}><RotateCcw size={16} /> Reset preview</button>
        : <button className="button primary" type="button" onClick={() => setFixed(true)}>Preview the fix <ArrowRight size={18} /></button>}
    </div>
  </section>;
}

function Home() {
  return <div className="home">
    <header className="home-header">
      <Brand />
      <nav aria-label="Main navigation">
        <a className="home-nav-link" href="#how-it-works">How it works</a>
        <a className="button dark compact" href="/workspace/">Open workspace <ArrowUpRight size={16} aria-hidden="true" /></a>
      </nav>
    </header>

    <main className="home-main">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-intro">
          <h1 id="home-title"><span>Catch the</span>{' '}<span>mismatch</span>{' '}<span>before it prints.</span></h1>
          <p>One print run. Two sets of specs. BatchCheck helps both sides approve the same version.</p>
          <div className="home-actions">
            <a className="button primary hero-button" href="/workspace/">Try the demo <ArrowRight size={20} aria-hidden="true" /></a>
            <a className="home-text-link" href="#how-it-works">See how it works <ArrowDown size={15} aria-hidden="true" /></a>
          </div>
        </div>
        <SamplePreview />
      </section>

      <section id="how-it-works" className="home-workflow" aria-labelledby="home-workflow-title">
        <h2 id="home-workflow-title">How it works</h2>
        <ol className="home-steps">
          {steps.map(({ title, detail }, index) => <li key={title}>
            <h3><span aria-hidden="true">{index + 1}.</span>{title}</h3>
            <p>{detail}</p>
          </li>)}
        </ol>
      </section>
    </main>

    <footer className="home-footer">
      <Brand />
      <a className="home-text-link" href="/workspace/">Try the demo <ArrowRight size={17} aria-hidden="true" /></a>
    </footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<Home />);
