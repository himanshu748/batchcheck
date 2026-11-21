import React from 'react';
import { Check } from 'lucide-react';

export function Brand() {
  return <a className="brand" href="/" aria-label="BatchCheck home">
    <span className="brand-mark"><Check size={19} strokeWidth={3} aria-hidden="true" /></span>
    BatchCheck
  </a>;
}
