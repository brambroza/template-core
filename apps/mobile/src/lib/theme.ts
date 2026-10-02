/** Same palette as the web app (modern minimal: ink on quiet greys, one safety-yellow accent). */
export const c = {
  ink: '#141C22',
  inkSoft: '#5B6670',
  concrete: '#F5F6F5',
  paper: '#FFFFFF',
  rule: '#E3E6E3',
  ruleSoft: '#EFF1EF',
  signal: '#F5C518',
  signalDeep: '#D9A800',
  ok: '#1F9D6B',
  warn: '#C98207',
  stop: '#D64535',
  progress: '#3B6FD8',
};

export const radius = 12;

export const toneColor = { neutral: c.inkSoft, progress: c.progress, ok: c.ok, warn: c.warn, stop: c.stop } as const;
