// @vitest-environment happy-dom
// fomo's REAL Buy panel (captured read-only 2026-10-12, SOL page, empty amount):
// the selectors the buy executor relies on must all resolve against it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { amountInUsd, findAmountInput, findConfirmSlot, findTradePanel, isDisabled, isSelected, readImpact, textOf } from '../src/executor/selectors';

const html = readFileSync(join(__dirname, 'fixtures/fomo-buy-panel-2026-10-12.html'), 'utf8');

beforeEach(() => {
  document.body.innerHTML = html;
});

describe("fomo's real Buy panel", () => {
  it('finds the panel with the Buy tab active and Sell inactive', () => {
    const p = findTradePanel(document)!;
    expect(p).not.toBeNull();
    expect(isSelected(p.buyTab)).toBe(true);
    expect(isSelected(p.sellTab)).toBe(false);
  });

  it('the amount box is in dollars', () => {
    const p = findTradePanel(document)!;
    expect(findAmountInput(p)?.placeholder).toBe('0');
    expect(amountInUsd(p)).toBe(true);
  });

  it('the confirm button reads "Buy SOL" (disabled until an amount is typed), not a $ preset', () => {
    const p = findTradePanel(document)!;
    const slot = findConfirmSlot(p);
    expect(textOf(slot)).toBe('Buy SOL');
    expect(isDisabled(slot)).toBe(true);
  });

  it("no quote yet: no impact read, and 'Lowest fees: 0.05%' is never taken as impact", () => {
    expect(readImpact(findTradePanel(document)!)).toEqual({ pct: null, unreadable: false });
  });
});
