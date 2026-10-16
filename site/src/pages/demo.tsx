import { render } from 'preact';
import '@ext/ui/tippy.css';
import '@ext/ui/window.css';
import '@ext/ui/page.css';
import '../site.css';
import '../demo/demo.css';
import { DemoApp } from '../demo/DemoApp';
import { Page } from '../layout';

// /demo?film: just the browser window on a plain stage, for recording the feature videos.
const film = new URLSearchParams(location.search).has('film');

render(
  film ? (
    <div class="site site-demo">
      <DemoApp film />
    </div>
  ) : (
    <Page current="demo" class="site-demo">
      <DemoApp />
    </Page>
  ),
  document.getElementById('app')!,
);
