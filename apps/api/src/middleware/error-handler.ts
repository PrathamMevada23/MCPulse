import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  void next;
  const isDev = process.env.NODE_ENV !== 'production';
  const message = error instanceof Error ? error.message : 'Unknown error';

  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      message,
      ...(isDev && error instanceof Error ? { stack: error.stack } : {}),
    }),
  );

  response.status(500).json({
    error: isDev ? `Development Error: ${message}` : 'Internal server error',
  });
};
