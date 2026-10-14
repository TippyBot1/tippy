import { render } from 'preact';
import '../../ui/tippy.css';
import '../../ui/page.css';
import '../../ui/page-root.css';
import '../../ui/window.css';
import { PopupPage } from '../../ui/pages/PopupPage';

render(<PopupPage />, document.getElementById('app')!);
