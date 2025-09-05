const pages = import.meta.glob('../pages/*/index.tsx', {
  eager: true,
}) as any;

const routes = Object.keys(pages).map(path => {
  const name = path.match(/\.\.\/pages\/(.*)\/index\.tsx$/)![1];

  return {
    name,
    path: name === 'Home' ? '/' : `/${name.toLowerCase()}`,
    component: pages[path].default,
    // ssr prefetch hook defined in component file
    prefetch: pages[path].prefetch,
  };
});

export type AppRoutes = typeof routes;
export const createRoutes = (): AppRoutes => routes;
