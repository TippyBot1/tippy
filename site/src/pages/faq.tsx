import { render, type ComponentChildren } from 'preact';
import '../site.css';
import { Page, PageHead } from '../layout';
import { EMAIL, STORE_LIVE } from '../links';

const FAQ: [string, ComponentChildren][] = [
  [
    'Does Tippy trade when my computer is off?',
    <>
      No. Tippy runs in Chrome on your computer, so it only buys or sells while the computer is awake and Chrome is open — and it keeps the computer awake while you have orders on. <a href="/how">What happens if it was asleep when a level hit</a>.
    </>,
  ],
  ['Will my stop always fill at my price?', 'No bot can promise that. Sells are market orders through fomo’s own Sell button, so in a fast dump or a thin pool the fill can land below your level. Tippy shows the price impact and lets you set limits on it.'],
  [
    'Can I try it without trading?',
    <>
      Yes. Turn on Dry run — the flask switch at the bottom of Tippy’s window — and Tippy walks through each order but stops before pressing Buy or Sell. A practice run goes one step further: it walks through a real sell or buy on fomo and stops right before the final button. Or try <a href="/demo">the demo</a>, which never touches fomo.
    </>,
  ],
  ['Does it work on my phone?', 'Tippy runs on your computer, in Chrome, Brave or Edge, while you’re logged in to fomo.family. You can still trade on your phone — Tippy sees those coins too, and Telegram alerts land on your phone.'],
  ['Can a limit buy spend more than I set?', 'No. Each limit buy spends only the amount you choose, once. If Tippy can’t confirm a buy went through, it stops and asks you instead of trying again. It also won’t chase a coin that pumped way past your level, or catch one that crashed straight through it.'],
  [
    'When can I install it?',
    STORE_LIVE
      ? 'Now, from the Chrome Web Store. Install it only from the official listing — never from a ZIP file or a link someone sends you.'
      : 'Soon. Tippy is waiting on its Chrome Web Store listing; until then the code is on GitHub. When it’s live, install it only from the official listing — never from a ZIP file or a link someone sends you.',
  ],
  ['Is Tippy made by fomo?', 'No. Tippy is an independent, open-source project and isn’t affiliated with or endorsed by fomo. If fomo changes its app, Tippy pauses safely instead of guessing.'],
  ['What does it cost?', 'Nothing. Tippy is free — no token, no subscription, no fees on your trades.'],
  ['Which chains?', 'Everything fomo trades on the web: Solana, Base, BNB Chain, Monad and Robinhood Chain.'],
];

function Faq() {
  return (
    <section class="section section-faq" aria-label="Questions and answers">
      <div class="wrap faq">
        <div class="faq-list">
          {FAQ.map(([q, a], i) => (
            <details key={q} open={i === 0}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

render(
  <Page current="faq">
    <PageHead
      eyebrow="FAQ"
      title="Questions"
      lead={
        <>
          The things people ask before they install. Something missing? <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </>
      }
    />
    <Faq />
  </Page>,
  document.getElementById('app')!,
);
