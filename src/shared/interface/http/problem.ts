import type { ZodError } from 'zod';
import { AppError, type ErrorKind } from '@/shared/domain';

export const STATUS_BY_KIND: Readonly<Record<ErrorKind, number>> = {
  validation: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

export interface FieldError {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

export interface ProblemInput {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly title?: string;
  readonly detail?: string;
  readonly instance?: string;
  readonly errors?: readonly FieldError[];
}

/** RFC 9457 Problem Details (extension members allowed). */
export type Problem = ProblemInput & { readonly type: string; readonly title: string } & Readonly<
    Record<string, unknown>
  >;

const TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

export function problemResponse(
  problem: ProblemInput & Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const body: Problem = { ...problem, type: 'about:blank', title: problem.title ?? TITLES[problem.status] ?? 'Error' };
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store', ...headers },
  });
}

export const zodProblemErrors = (e: ZodError): readonly FieldError[] =>
  e.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code }));

/**
 * The error boundary's translation table. Internal errors never leak messages,
 * stack traces or SQL to the client — only a request id for correlation.
 */
export function toProblem(
  error: unknown,
  requestId: string,
  instance: string,
): { response: Response; status: number; expected: boolean } {
  if (error instanceof HttpError) {
    return {
      response: problemResponse(
        { status: error.status, code: error.code, detail: error.message, requestId, instance },
        error.headers,
      ),
      status: error.status,
      expected: true,
    };
  }
  if (error instanceof AppError && error.kind !== 'internal') {
    const status = STATUS_BY_KIND[error.kind];
    const safeDetails = error.details ?? {};
    return {
      response: problemResponse({
        ...safeDetails,
        status,
        code: error.code,
        detail: error.message,
        requestId,
        instance,
      }),
      status,
      expected: true,
    };
  }
  return {
    response: problemResponse({
      status: 500,
      code: 'internal_error',
      detail: 'An unexpected error occurred',
      requestId,
      instance,
    }),
    status: 500,
    expected: false,
  };
}
