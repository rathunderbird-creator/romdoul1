import './polyfill';

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

// Global anti-double-click / fast-click handler
document.addEventListener('click', (e) => {
    let el = e.target as HTMLElement | null;
    while (el && el !== document.body) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
            if (el.hasAttribute('data-cooling-down')) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            el.setAttribute('data-cooling-down', 'true');
            setTimeout(() => {
                if (el) el.removeAttribute('data-cooling-down');
            }, 500); // 500ms cooldown
            break;
        }
        el = el.parentElement;
    }
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
