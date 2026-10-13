// Tippy's pop-ups on fomo's page: "Tippy filled order — Tippy bought $5 at
// $716K MC on $HIGGS." Shown in every open fomo tab, whatever coin it's on, even
// with the window minimised. A pop-up stays up for a few seconds of you actually
// looking at the tab (a fill that lands while the tab is in the background waits
// for you), pauses while the pointer is on it, and × closes it. Once closed or
// fully shown it stays gone in this tab, even after a reload or "View coin →".

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Notice } from '../shared/notices';
import { Mascot, type Mood } from './Mascot';

/** How long a pop-up stays up while the tab is visible. */
export const TOAST_MS = 12_000;
/** When a fomo page opens, notices this recent still pop up (a fill that landed while it loaded). */
export const TOAST_ON_LOAD_MS = 2 * 60_000;
/** Where this tab remembers the pop-ups it's done with (the page's sessionStorage). */
export const TOASTS_DONE_KEY = 'tippy:toasts-done';
const DONE_MAX = 50;
const MAX_SHOWN = 3;
const STEP_MS = 1_000;

const MOOD: Record<Notice['tone'], Mood> = { good: 'happy', stop: 'worried', info: 'watching' };

/** Pop-ups this tab already closed or showed in full. Storage can be blocked or throw: then just none. */
function readDone(): string[] {
  try {
    const v: unknown = JSON.parse(window.sessionStorage.getItem(TOASTS_DONE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveDone(ids: Set<string>) {
  try {
    window.sessionStorage.setItem(TOASTS_DONE_KEY, JSON.stringify([...ids].slice(-DONE_MAX)));
  } catch {
    /* storage blocked — they're still gone until the page reloads */
  }
}

export function Toasts({
  notices,
  here,
  onOpen,
  hidden = false,
}: {
  notices: Notice[];
  here?: string | null;
  onOpen?: (key: string) => void;
  /** Kept out of sight (e.g. while "Tippy is selling…" is up): nothing shows and no time counts. */
  hidden?: boolean;
}) {
  const [since] = useState(() => Date.now() - TOAST_ON_LOAD_MS);
  /** Visible time each pop-up has had. */
  const [seen, setSeen] = useState<Record<string, number>>({});
  /** Closed or fully shown — written straight to sessionStorage, so it holds across a reload. */
  const done = useRef<Set<string> | null>(null);
  if (!done.current) done.current = new Set(readDone());
  const [, redraw] = useState(0);
  const hovering = useRef(false);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  const finish = (ids: string[]) => {
    const set = done.current!;
    const fresh = ids.filter((id) => !set.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => set.add(id));
    saveDone(set);
    redraw((n) => n + 1);
  };

  const live = notices.filter((n) => n.at >= since && !done.current!.has(n.id) && (seen[n.id] ?? 0) < TOAST_MS).slice(-MAX_SHOWN);
  const ids = live.map((n) => n.id).join(',');
  const showing = !hidden && ids !== '';

  useEffect(() => {
    if (!ids) return;
    const t = setInterval(() => {
      if (hiddenNow.current || hovering.current || document.visibilityState !== 'visible') return;
      setSeen((s) => {
        const next = { ...s };
        for (const id of ids.split(',')) next[id] = (next[id] ?? 0) + STEP_MS;
        return next;
      });
    }, STEP_MS);
    return () => clearInterval(t);
  }, [ids]);

  // Shown in full: done for good in this tab.
  useEffect(() => {
    finish(Object.keys(seen).filter((id) => seen[id] >= TOAST_MS));
  }, [seen]);

  // Nothing on screen means nothing under the pointer: closing the last pop-up
  // while hovering it never fires mouseleave, which would freeze every later one.
  useEffect(() => {
    if (!showing) hovering.current = false;
  }, [showing]);

  if (!showing) return null;
  const close = (id: string) => finish([id]);

  return (
    <div
      class="tw-toasts"
      role="status"
      aria-live="polite"
      onMouseEnter={() => (hovering.current = true)}
      onMouseLeave={() => (hovering.current = false)}
    >
      {[...live].reverse().map((n) => (
        <div class={`tw-toast ${n.tone}`} key={n.id}>
          <Mascot mood={MOOD[n.tone]} size={30} />
          <div class="tw-toast-body">
            <b class="tw-toast-title">{n.title}</b>
            <span class="tw-toast-text">{n.text}</span>
            {onOpen && n.key && n.key !== here && (
              // Marked done before leaving: "View coin" loads a new page, which mustn't show it again.
              <button class="tw-toast-open" onClick={() => (close(n.id), onOpen(n.key))}>
                View coin →
              </button>
            )}
          </div>
          <button class="tw-toast-x" aria-label="Close" title="Close" onClick={() => close(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
