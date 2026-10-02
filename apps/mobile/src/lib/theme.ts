/** Same shop-floor palette as the web app. */
export const c = {
  ink: '#1F2A33',
  inkSoft: '#4A5762',
  concrete: '#EEF0EC',
  paper: '#FFFFFF',
  rule: '#C9CEC7',
  ruleSoft: '#E1E4DE',
  signal: '#F2C230',
  signalDeep: '#D9A80F',
  ok: '#2E7D5B',
  warn: '#C27C0E',
  stop: '#B83A2E',
  progress: '#2F5D8A',
};

export const toneColor = { neutral: c.inkSoft, progress: c.progress, ok: c.ok, warn: c.warn, stop: c.stop } as const;
