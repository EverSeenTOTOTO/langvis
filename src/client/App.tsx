import { ConfigProvider, theme as antdTheme } from 'antd';
import type { Request, Response } from 'express';
import { observer } from 'mobx-react-lite';
import { Route, Routes } from 'react-router-dom';
import { AppRoutes } from './routes';
import { AppStore, useStore } from './store';

import '@xyflow/react/dist/style.css';
import useI18n from './hooks/useI18n';
import useThemeClassname from './hooks/useThemeClassname';
import './index.scss';

export const App = observer(
  ({ routes }: { store: AppStore; routes: AppRoutes }) => {
    const setting = useStore('setting');
    const { locale } = useI18n();

    useThemeClassname();

    return (
      <ConfigProvider
        theme={{
          algorithm:
            setting.mode === 'dark'
              ? antdTheme.darkAlgorithm
              : antdTheme.defaultAlgorithm,
        }}
        locale={locale}
      >
        <Routes>
          {routes.map(({ path, component: RouteComponent }) => (
            <Route key={path} path={path} element={<RouteComponent />} />
          ))}
        </Routes>
      </ConfigProvider>
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
