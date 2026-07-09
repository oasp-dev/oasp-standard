/**
 * A structured, expected-failure error shared by the adapter and
 * server layers. Follows the house Result pattern: expected failures
 * (not found, invalid state, rejected precondition) flow back as data
 * via {@link Result}, never as a thrown exception.
 *
 * `code` is a stable machine-readable identifier (e.g.
 * `Session.NotFound`); `message` is human-readable and may change
 * without notice — callers must never branch on it.
 */
export interface DomainError {
  readonly code: string;
  readonly message: string;
}
