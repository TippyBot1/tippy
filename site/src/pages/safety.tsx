import { render } from 'preact';
import '../site.css';
import { NextPage, Page, PageHead } from '../layout';
import { GITHUB_URL } from '../links';

function Safety() {
  return (
    <section class="section section-safety" aria-label="Permissions and limits">
      <div class="wrap safety">
        <figure class="perm">
          <figcaption class="perm-label">What Chrome asks when you add Tippy</figcaption>
          <div class="perm-ask">
            <p class="perm-top">
              <img src="/favicon.svg" alt="" width="26" height="26" />
              Add “Tippy”?
            </p>
            <p class="perm-it">It can:</p>
            <blockquote>Read and change your data on fomo.family</blockquote>
          </div>
          <dl class="perm-table">
            <div>
              <dt>Sites it can open</dt>
              <dd>fomo.family</dd>
            </div>
            <div>
              <dt>Other websites</dt>
              <dd>No access</dd>
            </div>
            <div>
              <dt>Keys &amp; seed phrase</dt>
              <dd>Never asked for</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>None to create</dd>
            </div>
            <div>
              <dt>Desktop alerts</dt>
              <dd>Asked separately, if you turn them on</dd>
            </div>
          </dl>
        </figure>
        <div class="safety-r">
          <dl class="facts">
            <div>
              <dt>Private key or seed phrase</dt>
              <dd>
                <b>Never asked.</b> Anything that asks for one is a scam.
              </dd>
            </div>
            <div>
              <dt>Wallet connection</dt>
              <dd>
                <b>None.</b> Tippy presses fomo’s own buttons in your logged-in tab.
              </dd>
            </div>
            <div>
              <dt>Site access</dt>
              <dd>
                <b>fomo.family only.</b> It’s the one line Chrome shows when you add Tippy. Storage, alarms and keep-awake need no warning and can’t see other sites.
              </dd>
            </div>
            <div>
              <dt>Your fomo session</dt>
              <dd>
                <b>Stays in your tab.</b> Prices are read the way fomo’s page reads them. Nothing about your account is sent to us — unless you turn on Telegram alerts, which pass short fill messages to your chat.
              </dd>
            </div>
            <div>
              <dt>Tracking</dt>
              <dd>
                <b>None.</b> No analytics, no ads, no data sold.
              </dd>
            </div>
            <div>
              <dt>Source code</dt>
              <dd>
                <b>Open, MIT licensed.</b> Read every line on{' '}
                <a href={GITHUB_URL} target="_blank" rel="noopener">
                  GitHub
                </a>
                .
              </dd>
            </div>
            <div>
              <dt>Where to install</dt>
              <dd>
                <b>Only the official Chrome Web Store.</b> Never a ZIP file, never a link in a DM.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

render(
  <Page current="safety">
    <PageHead eyebrow="Safety" title="What Tippy can and can’t do" lead="Tippy can only do what you could do yourself in your fomo tab: press fomo’s buttons. It never holds funds and never sees a key." />
    <Safety />
    <NextPage from="safety" />
  </Page>,
  document.getElementById('app')!,
);
