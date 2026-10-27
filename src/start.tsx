import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

/**
 * TanStack Start instance
 * https://github.com/backpine/tanstack-start-on-cloudflare/blob/main/src/start.tsx
 */
declare module '@tanstack/react-start' {
  interface Register {
    server: {
      requestContext: {
        fromFetch: boolean;
      };
    };
  }
}

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === 'serverFn',
});

export const startInstance = createStart(() => {
  return {
    defaultSsr: true,
    requestMiddleware: [csrfMiddleware],
  };
});

startInstance.createMiddleware().server(({ next }) => {
  return next({
    context: {
      fromStartInstanceMw: true,
    },
  });
});
