import type { ServerState } from './store/server-state';

/**
 * Serializes `fn` per `conversationId`, satisfying
 * `docs/spec/interactions.md` § Stage 4's requirement that a server
 * "serialize `migrate` per Conversation... so that two concurrent
 * `migrate` calls on the same Conversation cannot both read the same
 * outgoing Session and race the `previousSessionIds` append."
 *
 * Implemented as a promise chain per conversation id: each call waits
 * for the previous holder (success or failure) before running `fn`,
 * then hands the baton to whoever calls next. This is a mutex, not a
 * queue with cancellation — a caller whose turn never comes because an
 * earlier holder never resolves would hang, which is an accepted
 * tradeoff for an in-memory reference implementation with no I/O that
 * can genuinely hang forever.
 */
export function withConversationLock<T>(state: ServerState, conversationId: string, fn: () => Promise<T>): Promise<T> {
  const previousLock = state.conversationLocks.get(conversationId) ?? Promise.resolve();
  const result = previousLock.then(fn, fn);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  state.conversationLocks.set(conversationId, settled);
  return result;
}
