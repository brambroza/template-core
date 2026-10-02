'use client';

export type ToastTone = 'info' | 'ok' | 'warn' | 'stop';
export interface ToastMsg {
  title: string;
  body?: string;
  tone?: ToastTone;
  /** in-app link opened by the toast's button */
  href?: string;
}

/** Show a small message in the corner. Rendered by <Toaster/> in the shell. */
export function toast(t: ToastMsg) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ToastMsg>('erp:toast', { detail: t }));
}
