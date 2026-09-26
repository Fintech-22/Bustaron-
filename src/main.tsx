import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

const rootElement: HTMLElement | null = document.getElementById('root');

if (rootElement === null) {
  throw new Error('BUSTARON root element was not found.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
