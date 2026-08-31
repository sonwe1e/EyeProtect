import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/base.css';
import './styles.css';
import './styles/primitives.css';
import './styles/workbench.css';
import './styles/collection.css';
import './styles/settings.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
