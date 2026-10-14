import { render } from 'preact';
import '@ext/ui/tippy.css';
import '@ext/ui/window.css';
import '@ext/ui/page.css';
import '../site.css';
import '../demo/demo.css';
import { DemoApp } from '../demo/DemoApp';
import { Page } from '../layout';

render(
  <Page current="demo" class="site-demo">
    <DemoApp />
  </Page>,
  document.getElementById('app')!,
);
