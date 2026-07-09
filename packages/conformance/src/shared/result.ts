import type { DomainError } from './domain-error.types';

/**
 * The outcome of an operation that can fail in an expected way: either
 * a success value or a structured {@link DomainError}. Discriminate on
 * `ok`. Used throughout the adapter and server layers instead of
 * throwing for expected failures (not found, invalid state, rejected
 * precondition) — exceptions are reserved for genuinely unexpected
 * failures (a bug, a broken invariant).
 */
export type Result<TSuccess, TError = DomainError> =
  | { readonly ok: true; readonly value: TSuccess }
  | { readonly ok: false; readonly error: TError };

/** Builds a successful {@link Result}. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Builds a failed {@link Result}. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
