import { render } from 'preact';
import '../../ui/tippy.css';
import '../../ui/page.css';
import '../../ui/page-root.css';
import { WelcomePage } from '../../ui/pages/WelcomePage';

render(<WelcomePage />, document.getElementById('app')!);
