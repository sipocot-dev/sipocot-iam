import type { AppError, Result } from '@/shared/domain';

export const json = (data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response =>
  new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });

export const noContent = (headers: Record<string, string> = {}): Response =>
  new Response(null, { status: 204, headers });

/** Turns an expected use-case failure into a thrown AppError for the error boundary. */
export function unwrap<T>(result: Result<T, AppError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
