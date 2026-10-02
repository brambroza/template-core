/** Only same-app paths may be followed from data (notification links, assistant buttons). */
export const safeHref = (href?: string | null): string | undefined =>
  typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\') ? href : undefined;
