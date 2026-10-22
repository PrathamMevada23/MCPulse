/**
 * Minimal req/res mock for testing Express route handlers without HTTP.
 * No network, no sockets — just plain objects shaped like IncomingMessage/Response.
 */
import type { NextFunction, Request, Response } from 'express';

type BodyJson = Record<string, unknown> | null;

export type MockResponse = {
  statusCode: number;
  body: BodyJson;
  /** Call this to get the captured response after calling a handler. */
  result: () => { status: number; body: BodyJson };
};

export const mockRes = (): Response & MockResponse => {
  const state = { statusCode: 200, body: null as BodyJson };

  const res = {
    get statusCode() { return state.statusCode; },
    get body() { return state.body; },
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(data: BodyJson) {
      state.body = data;
      return res;
    },
    end() {
      return res;
    },
    result() {
      return { status: state.statusCode, body: state.body };
    },
  } as unknown as Response & MockResponse;

  return res;
};

export const mockReq = (overrides: Partial<Request> = {}): Request =>
  ({
    params: {},
    query: {},
    body: {},
    ...overrides,
  }) as Request;

export const noopNext: NextFunction = () => undefined;
