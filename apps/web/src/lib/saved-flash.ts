'use client';

/**
 * "Just created" hand-over from a form to the document it opens (SavedPanel). In memory, keyed by the path —
 * never in the URL, so the address a person copies (or a script reads) is the document's real address from the start.
 */
let pending: string | null = null;

export function markSaved(path: string): void {
  pending = path.split('?')[0];
}

/** was this path just saved? (pure read: React may call a state initializer twice in development) */
export function wasJustSaved(path: string): boolean {
  return !!pending && pending === path;
}

/** forget the flag once the document has shown it, so a reload or a later visit does not repeat it */
export function clearSaved(): void {
  pending = null;
}
