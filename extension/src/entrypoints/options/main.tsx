import { render } from 'preact';
import '../../ui/tippy.css';
import '../../ui/page.css';
import '../../ui/page-root.css';
import { SettingsPage } from '../../ui/pages/SettingsPage';

render(<SettingsPage />, document.getElementById('app')!);
