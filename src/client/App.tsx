import { Theme } from '@radix-ui/themes';
import type { Request, Response } from 'express';
import { observer } from 'mobx-react-lite';
import { Route, Routes } from 'react-router-dom';
import { AppRoutes } from './routes';
import { AppStore, useStore } from './store';

import '@radix-ui/themes/styles.css';
import '@xyflow/react/dist/style.css';
import './styles/index.scss';

export const App = observer(
  ({ routes }: { store: AppStore; routes: AppRoutes }) => {
    const theme = useStore('theme');

    return (
      <Theme appearance={theme.mode} accentColor="blue">
        <Routes>
          {routes.map(({ path, component: RouteComp }) => (
            <Route key={path} path={path} element={<RouteComp />} />
          ))}
        </Routes>
      </Theme>
    );
  },
);

export type RenderContext = {
  req: Request;
  res: Response;
  template: string;
  html?: string;
  routes?: AppRoutes;
  store?: AppStore;
};

export type PrefetchContext = Omit<
  Required<RenderContext>,
  'req' | 'res' | 'template' | 'html'
> & { req: { originalUrl: string } };

export function prefetch(ctx: PrefetchContext) {
  const matched = ctx.routes.filter(each => each.path === ctx.req.originalUrl);

  const ps: Promise<void>[] = [];

  matched.forEach(route => {
    if (typeof route.prefetch === 'function') {
      ps.push(route.prefetch(ctx));
    }
  });

  return Promise.all(ps);
}
