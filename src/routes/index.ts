const pages = import.meta.glob('../pages/*.tsx', {
  eager: true,
}) as any;

const routes = Object.keys(pages).map(path => {
  const name = path.match(/\.\.\/pages\/(.*)\.tsx$/)![1];

  return {
    name,
    path: name === 'Home' ? '/' : `/${name.toLowerCase()}`,
    component: pages[path].default,
    // ssr prefetch hook defined in component fil
    prefetch: pages[path].prefetch,
  };
});

export type AppRoutes = typeof routes;
export const createRoutes = (): AppRoutes => routes;
