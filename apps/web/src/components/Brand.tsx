/**
 * Brand v2 marks: the Factory OS logo (navy tile, white stacked-block "F", AI spark) and the AI spark icon.
 * The AI gradient (indigo → violet → cyan) is reserved for things that really are AI/automation — see globals.css `--ai-*`.
 */
import { useId } from 'react';

/** Modules whose screens are bots/automation: they get the AI accent (gradient icon, hairline), nothing else does. */
const AI_MODULES = new Set(['automation']);
export const isAiModule = (module: string) => AI_MODULES.has(module);

const AI_STOPS = [['0', '#4F46E5'], ['.45', '#8B5CF6'], ['1', '#06B6D4']] as const;

/** Four-point spark (the "AI" sign) as a path inside a 24×24 box. */
const SPARK = 'M12 2.5c.5 4.6 2.4 7 7 8.2l2.5.6-2.5.6c-4.6 1.2-6.5 3.6-7 8.2-.5-4.6-2.4-7-7-8.2L2.5 11.3 5 10.7c4.6-1.2 6.5-3.6 7-8.2Z';

/** Logo mark: rounded navy square, white "F" built from three blocks, gradient spark top-right. */
export function LogoMark({ size = 36, className, title }: { size?: number; className?: string; title?: string }) {
  const id = `lg${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {AI_STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="#0B1324" />
      <rect x=".75" y=".75" width="62.5" height="62.5" rx="14.25" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="1.5" />
      <rect x="17" y="15" width="10" height="35" rx="2.5" fill="#fff" />
      <rect x="30" y="15" width="12" height="10" rx="2.5" fill="#fff" />
      <rect x="30" y="28.5" width="11" height="9.5" rx="2.5" fill="#fff" fillOpacity=".82" />
      <path d={SPARK} transform="translate(41 4) scale(.82)" fill={`url(#${id})`} />
    </svg>
  );
}

/** Logo mark + "Factory OS" wordmark (+ optional "by GO Along"). */
export function Wordmark({ size = 36, by = false }: { size?: number; by?: boolean }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wordmark-text"><b>Factory OS</b>{by && <small>by GO Along</small>}</span>
    </span>
  );
}

/** The AI spark icon filled with the AI gradient — only on AI surfaces (⌘K, assistant, briefing, AI fill, bots). */
export function AiSpark({ size = 18, className }: { size?: number; className?: string }) {
  const id = `sp${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`ai-spark${className ? ` ${className}` : ''}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {AI_STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
      </defs>
      <path d={SPARK} fill={`url(#${id})`} />
      <path d="M19.2 2.2c.2 1.3.7 1.9 2 2.2-1.3.3-1.8.9-2 2.2-.2-1.3-.7-1.9-2-2.2 1.3-.3 1.8-.9 2-2.2Z" fill={`url(#${id})`} opacity=".85" />
    </svg>
  );
}

/**
 * One hidden gradient definition for the whole page, so any lucide (stroke) icon inside `.ai-icon` can be
 * painted with it via CSS (`stroke: url(#ai-stroke)`). Rendered once by the Shell.
 */
export function AiGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <defs>
        <linearGradient id="ai-stroke" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          {AI_STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
        <linearGradient id="ai-stroke-bright" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#818CF8" /><stop offset=".45" stopColor="#A78BFA" /><stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
    </svg>
  );
}
