import type { AppError, Result } from '@/shared/domain';

export interface UseCase<TInput, TOutput> {
  execute(input: TInput): Promise<Result<TOutput, AppError>>;
}
