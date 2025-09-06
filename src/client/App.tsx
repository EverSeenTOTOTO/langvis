import {
  legacyLogicalPropertiesTransformer,
  px2remTransformer,
  StyleProvider,
} from '@ant-design/cssinjs';
import { theme as antdTheme, ConfigProvider } from 'antd';
import type { Request, Response } from 'express';
import { observer } from 'mobx-react-lite';
import { Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { AppRoutes } from './routes';
import { AppStore, useStore } from './store';

import useThemeClassname from './hooks/useThemeClassname';
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
          cssVar: true,
        }}
        locale={setting.locale}
      >
        <StyleProvider
          transformers={[legacyLogicalPropertiesTransformer, px2rem]}
        >
          <Routes>
            {routes.map(({ path, component: RouteComponent }) => {
              // Skip authentication for login page
              const isLoginPage = path === '/login';

              return (
                <Route
                  key={path}
                  path={path}
                  element={
                    <ProtectedRoute skipAuth={isLoginPage}>
                      <RouteComponent />
                    </ProtectedRoute>
                  }
                />
              );
            })}
          </Routes>
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
  const matched = ctx.routes.filter(each => each.path === ctx.req.originalUrl);

  const ps: Promise<void>[] = [];

  matched.forEach(route => {
    if (typeof route.prefetch === 'function') {
      ps.push(route.prefetch(ctx));
    }
  });

  return Promise.all(ps);
}
