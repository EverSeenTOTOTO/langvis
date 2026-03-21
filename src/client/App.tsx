import {
  legacyLogicalPropertiesTransformer,
  px2remTransformer,
  StyleProvider,
} from '@ant-design/cssinjs';
import { App as AntdApp, theme as antdTheme, ConfigProvider } from 'antd';
import type { Request, Response } from 'express';
import { observer } from 'mobx-react-lite';
import { Route, Routes } from 'react-router-dom';
import ClientOnly from './components/ClientOnly';
import ProtectedRoute from './components/ProtectedRoute';
import useThemeClassname from './hooks/useThemeClassname';
import NotFound from './pages/NotFound';
import { AppRoutes } from './routes';
import { AppStore, useStore } from './store';

import './index.scss';

const px2rem = px2remTransformer({
  rootValue: 16,
});

export const App = observer(
  ({ routes }: { store: AppStore; routes: AppRoutes }) => {
    const setting = useStore('setting');

    useThemeClassname();

    return (
      <ConfigProvider
        theme={{
          algorithm:
            setting.mode === 'dark'
              ? antdTheme.darkAlgorithm
              : antdTheme.defaultAlgorithm,
        }}
        locale={setting.locale}
      >
        <StyleProvider
          transformers={[legacyLogicalPropertiesTransformer, px2rem]}
        >
          <AntdApp>
            <Routes>
              {routes.map(({ path, component: RouteComponent }) => {
                const skipAuth = ['/login'].includes(path);
                const withHeader = !['/login'].includes(path);
                const isLogin = path === '/login';

                const routeElement = (
                  <ProtectedRoute skipAuth={skipAuth} withHeader={withHeader}>
                    <RouteComponent />
                  </ProtectedRoute>
                );

                return (
                  <Route
                    key={path}
                    path={path}
                    element={
                      isLogin ? (
                        <ClientOnly>{routeElement}</ClientOnly>
                      ) : (
                        routeElement
                      )
                    }
                  />
                );
              })}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AntdApp>
        </StyleProvider>
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
  const path = (ctx.req.originalUrl || '/').replace(/\?.*$/, '');
  const matched = ctx.routes.filter(each => each.path === path);

  const ps: Promise<void>[] = [];

  matched.forEach(route => {
    if (typeof route.prefetch === 'function') {
      ps.push(route.prefetch(ctx));
    }
  });

  return Promise.all(ps);
}
