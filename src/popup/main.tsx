import { render } from 'preact';
import type { Settings } from '@shared/schema';
import { chromePageApi } from '../ui/api';
import { installPageTheme } from '../ui/page-styles';
import { Popup } from './Popup';

let theme: Settings['theme'] = 'auto';
const applyTheme = installPageTheme(() => theme);
const root = document.getElementById('app');
if (root) {
  render(
    <Popup
      api={chromePageApi()}
      onSettings={(s) => {
        theme = s.theme;
        applyTheme();
      }}
    />,
    root,
  );
}
