// 💬 Chat with Tippy: "tp at 500k mcap", "sl -30% on CLAUDIA", "buy $10 if it dips 20%".
// Built in and local — parse.ts reads the message, chat/run.ts works out the change,
// nothing leaves the computer. Tippy never acts on a message: every change comes
// back as a card ("Add a take-profit on $CLAUDIA: …  [Add it] [Cancel]") and only
// the tap runs it — once.
//
// Small on purpose: a one-line box at the bottom of the window; the last few
// exchanges show above it once you've asked something, ✕ clears them. ↑ recalls
// what you sent. Keys typed here never reach fomo's page shortcuts.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChatPlan } from '../chat/intent';
import { parse } from '../chat/parse';
import { type ChatCtx, planIntent } from '../chat/run';

interface Turn {
  id: number;
  /** What you typed. */
  text: string;
  /** Tippy's answer (null while thinking). */
  reply: ChatPlan | null;
  /** 'ask' = card waiting for your tap. */
  state: 'ask' | 'running' | 'done' | 'dismissed';
  result?: { ok: boolean; text: string };
}

/** Exchanges kept on screen. */
const KEEP = 3;
const HISTORY = 20;

/** Destructive verbs get "Keep it" instead of a second "Cancel" next to them. */
const dismissLabel = (label: string) => (/^(cancel|stop|remove)/i.test(label) ? 'Keep it' : 'Cancel');

export function Chat({ ctx, placeholder = 'Ask Tippy… e.g. tp at 500k mcap' }: { ctx: ChatCtx; placeholder?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  /** What you sent, oldest first (↑ / ↓ walk through it). */
  const sent = useRef<string[]>([]);
  const recall = useRef<number | null>(null);
  /** Cards that were tapped — each runs at most once, however fast the clicks. */
  const tapped = useRef(new Set<number>());
  const nextId = useRef(1);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);
  /** After a tap the button goes away — put the cursor back so you can keep typing. */
  const refocus = () => box.current?.focus({ preventScroll: true });

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const patch = (id: number, p: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const ask = async (raw: string) => {
    const msg = raw.trim();
    if (!msg) return;
    sent.current = [...sent.current.filter((m) => m !== msg), msg].slice(-HISTORY);
    recall.current = null;
    setText('');
    const id = nextId.current++;
    setTurns((ts) => {
      // A new question retires cards still waiting for a tap: only the newest can be confirmed.
      const retired = ts.map((t) => (t.state === 'ask' && t.reply?.confirm ? { ...t, state: 'dismissed' as const, result: { ok: false, text: 'Skipped — nothing changed.' } } : t));
      const next = [...retired, { id, text: msg, reply: null, state: 'ask' as const }];
      // Keep the last few, plus anything still running so its result has somewhere to land.
      return next.filter((t, i) => i >= next.length - KEEP || t.state === 'running');
    });
    let reply: ChatPlan;
    try {
      const c = ctxRef.current;
      reply = await planIntent(parse(msg, { levelUnit: c.settings.levelUnit }), c);
    } catch {
      reply = { say: 'Sorry, I tripped over that one — try saying it another way?', warn: true };
    }
    patch(id, { reply });
  };

  const confirm = async (t: Turn) => {
    const c = t.reply?.confirm;
    if (!c || tapped.current.has(t.id)) return;
    tapped.current.add(t.id);
    patch(t.id, { state: 'running' });
    refocus();
    let result: Turn['result'];
    try {
      const r = await c.run();
      result = r.ok ? { ok: true, text: r.say ?? 'Done!' } : { ok: false, text: r.error };
    } catch {
      result = { ok: false, text: 'Something went wrong — check my window before trying again.' };
    }
    patch(t.id, { state: 'done', result });
  };

  const dismiss = (t: Turn) => {
    if (tapped.current.has(t.id)) return;
    tapped.current.add(t.id);
    patch(t.id, { state: 'dismissed', result: { ok: false, text: 'Cancelled — nothing changed.' } });
    refocus();
  };

  const busy = turns.some((t) => t.state === 'running');

  const onKey = (e: KeyboardEvent) => {
    const input = e.currentTarget as HTMLInputElement;
    const list = sent.current;
    if (e.key === 'ArrowUp' && list.length && (input.value === '' || recall.current != null)) {
      e.preventDefault();
      const i = recall.current == null ? list.length - 1 : Math.max(0, recall.current - 1);
      recall.current = i;
      setText(list[i]);
    } else if (e.key === 'ArrowDown' && recall.current != null) {
      e.preventDefault();
      const i = recall.current + 1;
      recall.current = i < list.length ? i : null;
      setText(i < list.length ? list[i] : '');
    } else if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      recall.current = null;
      setText('');
    }
  };

  // Keys stay in Tippy: fomo's page shortcuts never see what's typed here.
  const stop = (e: Event) => e.stopPropagation();

  return (
    <div class={`tw-chat${turns.length ? ' open' : ''}`} onKeyDown={stop} onKeyUp={stop} onKeyPress={stop}>
      {turns.length > 0 && (
        <div class="tw-chat-log" ref={log} role="log" aria-label="Chat with Tippy">
          {turns.map((t) => (
            <div class="tw-chat-turn" key={t.id}>
              <div class="tw-chat-you">{t.text}</div>
              <div class={`tw-chat-tippy${t.reply?.warn ? ' warn' : ''}`} aria-live="polite">
                {t.reply ? t.reply.say : <span class="tw-chat-dots" aria-label="Tippy is thinking">…</span>}
                {t.reply?.confirm &&
                  (t.state === 'ask' || t.state === 'running' ? (
                    <div class="tw-chat-acts">
                      <button class="tw-chat-ok" disabled={t.state === 'running'} onClick={() => confirm(t)}>
                        {t.state === 'running' ? 'Working…' : t.reply.confirm.label}
                      </button>
                      <button class="tw-chat-no" disabled={t.state === 'running'} onClick={() => dismiss(t)}>
                        {dismissLabel(t.reply.confirm.label)}
                      </button>
                    </div>
                  ) : (
                    t.result && (
                      <div class={`tw-chat-result${t.state === 'done' ? (t.result.ok ? ' ok' : ' warn') : ''}`} role="status">
                        {t.result.text}
                      </div>
                    )
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <form
        class="tw-chat-bar"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <span class="tw-chat-icon" aria-hidden="true">
          💬
        </span>
        <input
          ref={box}
          value={text}
          placeholder={placeholder}
          aria-label="Ask Tippy (Enter to send)"
          autoComplete="off"
          spellcheck={false}
          maxLength={200}
          onInput={(e) => {
            recall.current = null;
            setText(e.currentTarget.value);
          }}
          onKeyDown={onKey}
        />
        {turns.length > 0 && (
          <button
            type="button"
            class="tw-chat-clear"
            aria-label="Clear the chat"
            title={busy ? 'Wait for Tippy to finish' : 'Clear the chat'}
            disabled={busy}
            onClick={() => {
              setTurns([]);
              recall.current = null;
            }}
          >
            ✕
          </button>
        )}
      </form>
    </div>
  );
}
