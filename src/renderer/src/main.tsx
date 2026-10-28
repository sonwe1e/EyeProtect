import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installTauriBridge, isTauriRuntime } from './lib/tauriBridge';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/base.css';
import './styles.css';
import './styles/primitives.css';

const start = async (): Promise<void> => {
  if (isTauriRuntime()) await installTauriBridge();
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

void start();
