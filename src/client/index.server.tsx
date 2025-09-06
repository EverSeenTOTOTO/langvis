import { createCache, extractStyle } from '@ant-design/cssinjs';
import { enableStaticRendering } from 'mobx-react-lite';
import ReactDOMServer from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import serializeJavascript from 'serialize-javascript';
import { App, RenderContext, prefetch } from './App';
import { createRoutes } from './routes';
import { createStore } from './store';
import { getPrefetchPath, serverFetch } from './decorator/api';
import { isEmpty } from 'lodash-es';
import { getSessionHeaders } from '@/server/utils';

enableStaticRendering(true);

// see index.html
const APP_HTML = '<!--app-html-->';
const APP_STATE = '<!--app-state-->';
const APP_STYLE = '<!--app-style-->';

const serialize = (state: Record<string, unknown> | undefined) =>
  `<script>;window.__PREFETCHED_STATE__=${serializeJavascript(state)};</script>`;

const styleCache = createCache();

export async function render(context: RenderContext) {
  const ctx = context as Required<RenderContext>;
  const { req } = ctx;

  const store = createStore();
  const routes = createRoutes();
  ctx.store = store;
  ctx.routes = routes;

  if (!isEmpty(req.cookies)) {
    // prefetch user session if client cookie present
    await store.auth
      .getSession({
        fetchOptions: {
          headers: getSessionHeaders(req),
        },
      })
      .catch(e => {
        req.log.error(e);
      });

    // sync client cookie to futher server prefetch env
    const fullUrl = getPrefetchPath(req.originalUrl);
    const cookieStr = Object.entries(req.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

    serverFetch.cookieJar.setCookie(cookieStr, fullUrl, {
      ignoreError: false,
    });
  }

  const success = await prefetch(ctx).catch(e => {
    req.log.error(e);

    return false;
  });

  const html = ReactDOMServer.renderToString(
    <StaticRouter location={req.originalUrl}>
      <App store={store} routes={routes} />
    </StaticRouter>,
  );

  const styleText = extractStyle(styleCache);
  // state avaliable now
  const state = success ? store.dehydra() : undefined;

  ctx.html = ctx.template
    .replace(APP_HTML, html)
    .replace(APP_STYLE, styleText)
    .replace(APP_STATE, serialize(state));

  return ctx;
}

