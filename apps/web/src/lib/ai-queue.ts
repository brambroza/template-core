'use client';

/**
 * "สร้างจากเอกสาร" with many files: dropped on a list (or on a form), they wait here and the form reads them one at a
 * time — the person checks and saves each, then the next opens. In memory only (files cannot live in storage);
 * a page reload ends the queue, nothing is lost because nothing was saved for unread files.
 */
export interface AiQueue { key: string; files: File[]; total: number }

let queue: AiQueue | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const keyOf = (module: string, screen: string) => `${module}/${screen}`;

/** Files the AI can read (images, PDF); others are dropped with a count for the message. */
export function readable(files: Iterable<File>): { ok: File[]; skipped: number } {
  const all = [...files];
  const ok = all.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
  return { ok, skipped: all.length - ok.length };
}

export function enqueue(module: string, screen: string, files: File[]): void {
  queue = { key: keyOf(module, screen), files: [...files], total: files.length };
  notify();
}

/** The next file for this form, or undefined; `position` is 1-based among all queued files. */
export function takeNext(module: string, screen: string): { file: File; position: number; total: number } | undefined {
  if (!queue || queue.key !== keyOf(module, screen) || !queue.files.length) return undefined;
  const file = queue.files.shift()!;
  const out = { file, position: queue.total - queue.files.length, total: queue.total };
  notify();
  return out;
}

export function remaining(module: string, screen: string): number {
  return queue && queue.key === keyOf(module, screen) ? queue.files.length : 0;
}

export function clearQueue(): void {
  queue = null;
  notify();
}

export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
