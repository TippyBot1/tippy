// Low-level DOM helpers for driving a React app from an isolated-world content
// script. Events are dispatched as a full pointer → mouse → click sequence
// because some component libraries activate on pointerdown/mousedown.

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs: number, stepMs = 150): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(stepMs);
  }
}

export function press(el: HTMLElement) {
  const view = el.ownerDocument.defaultView ?? window;
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, view };
  const P = (view as typeof window).PointerEvent ?? (view as typeof window).MouseEvent;
  el.focus?.();
  el.dispatchEvent(new P('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true } as PointerEventInit));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new P('pointerup', { ...opts, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true } as PointerEventInit));
  el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
  el.click();
}

/** Set a React-controlled input's value so React sees the change. */
export function setControlledValue(input: HTMLInputElement, value: string) {
  input.focus();
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
