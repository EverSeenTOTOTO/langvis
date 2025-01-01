import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, prefetch } from './App';
import { createRoutes } from './routes';
import { createStore } from './store';
import '@radix-ui/themes/styles.css';
import './styles/index.scss';

const container = document.getElementById('root');

const store = createStore();
const routes = createRoutes();

if (window.__PREFETCHED_STATE__) {
  // merge ssr prefetched data
  store.hydrate(window.__PREFETCHED_STATE__);
  delete window.__PREFETCHED_STATE__;
} else {
  // fallback to client prefetch
  prefetch({ routes, store, req: { originalUrl: window.location.pathname } });
}

hydrateRoot(
  container!,
  <BrowserRouter>
    <App store={store} routes={routes} />
  </BrowserRouter>,
);
