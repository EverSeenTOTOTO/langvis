import type { Request, Response } from 'express';
import { Route, Routes } from 'react-router-dom';
import { AppRoutes } from './routes';
import { AppStore, useStore } from './store';
import { Theme } from '@radix-ui/themes';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

export const App = observer(
  ({ routes }: { store: AppStore; routes: AppRoutes }) => {
    const theme = useStore('theme');
    const supabase = useStore('supabase');
    const graph = useStore('graph');

    useEffect(() => {
      supabase.setClient(
        createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_ANON_KEY,
        ),
      );
    }, []);
    useEffect(() => {
      const nodeTypes = import.meta.glob('@/client/components/GUINodes/*.tsx', {
        eager: true,
      }) as any;

      Object.keys(nodeTypes).forEach(path => {
        const type = path
          .match(/src\/client\/components\/GUINodes\/(.*)\.tsx$/)![1]
          .toLowerCase();

        graph.registerNodeType(type, nodeTypes[path].default);
      });
    }, []);

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
