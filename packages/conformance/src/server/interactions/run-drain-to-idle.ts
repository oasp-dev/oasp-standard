import type { AgentDefinition } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { serverErrors } from '../server-errors';
import type { ToolExecutor } from '../tool-executor.types';
import { authorizePendingToolCall } from './authorize-pending-tool-call';
import type { DrainOutcome } from './drain.types';

/**
 * The `drain` normative behaviour itself (`docs/spec/interactions.md`
 * § `drain`), factored out from audit emission so it can be reused
 * both by the client-facing `drainInteraction` (which audits it) and
 * by `migrate`'s Stage 3 (see `migrate.ts`), which per this package's
 * interpretation does not separately audit its internal drain — see
 * the note in `migrate.ts` for that call.
 *
 * Enumerates every pending tool call via `getPendingToolCalls`, then
 * authorizes the ENTIRE enumerated batch against `definitionVersion`
 * (the pinned `AgentDefinition` version's immutable content snapshot
 * reachable from the Session's `pinnedAgentVersion`, resolved by the
 * caller via `store/agent-definition-version-store.ts` — issue #10; see
 * `authorize-pending-tool-call.ts` and `docs/spec/interactions.md` §
 * `drain`'s authorization clause, issue #9) *before* dispatching any of
 * it to the injected `toolExecutor`. If any call in the batch is
 * unauthorized, NONE of the batch is executed — not even a call that
 * would itself have been authorized — since an adversarial batch could
 * otherwise place its unauthorized call last, letting earlier calls
 * dispatch before detection; every enumerated call still gets a posted
 * domain-error result via `sendToolResult` (so nothing remains parked
 * forever waiting on a response that will never come), and this
 * function returns the (first) authorization failure. Otherwise, every
 * call is executed via `toolExecutor`, its result posted back via
 * `sendToolResult`, and — once every enumerated call has a posted
 * result — the session's status is confirmed `'idle'`. Idempotent: a
 * session with no pending tool calls resolves immediately as a no-op
 * success. Returns failure for ANY terminal status other than `'idle'`
 * — both a terminal `status: 'error'` session and a session still (or
 * again) `'running'` once every enumerated call has been posted (e.g. a
 * chained tool call re-parked it — `docs/spec/adapters.md`'s
 * `getSessionStatus` contract makes this ordinary provider behaviour,
 * not a rare fault). `docs/spec/interactions.md` § `drain` (L355-362)
 * is a MUST that success means confirmed `idle`, never merely "no error
 * was seen" — the caller (`drainInteraction`, and `migrate`'s Stage 3)
 * is what turns either failure into an audited outcome / a rejected
 * swap.
 */
export async function runDrainToIdle(
  provider: AgentProvider,
  toolExecutor: ToolExecutor,
  definitionVersion: Pick<AgentDefinition, 'tools'>,
  sessionId: string,
): Promise<Result<DrainOutcome, DomainError>> {
  const pendingResult = await provider.getPendingToolCalls(sessionId);
  if (!pendingResult.ok) return err(serverErrors.adapterFailure('getPendingToolCalls', pendingResult.error.message));

  const authorizationFailure = pendingResult.value
    .map((toolCall) => authorizePendingToolCall(definitionVersion, sessionId, toolCall))
    .find((result) => !result.ok);

  if (authorizationFailure && !authorizationFailure.ok) {
    // Reject the entire enumerated batch pre-dispatch: the executor is
    // never invoked for any of it. Still post a domain-error result for
    // every pending call — including ones that would themselves have
    // authorized cleanly — so nothing remains parked forever, then
    // surface the (first) rejection as this drain's failure outcome.
    for (const toolCall of pendingResult.value) {
      const rejectionPostResult = await provider.sendToolResult(sessionId, toolCall.toolUseId, { error: authorizationFailure.error.message });
      if (!rejectionPostResult.ok) return err(serverErrors.adapterFailure('sendToolResult', rejectionPostResult.error.message));
    }
    return err(authorizationFailure.error);
  }

  const resolvedToolUseIds: string[] = [];
  for (const toolCall of pendingResult.value) {
    const executionResult = await toolExecutor.execute(toolCall);
    const resultValue = executionResult.ok ? executionResult.value : { error: executionResult.error.message };

    const postResult = await provider.sendToolResult(sessionId, toolCall.toolUseId, resultValue);
    if (!postResult.ok) return err(serverErrors.adapterFailure('sendToolResult', postResult.error.message));
    resolvedToolUseIds.push(toolCall.toolUseId);
  }

  const statusResult = await provider.getSessionStatus(sessionId);
  if (!statusResult.ok) return err(serverErrors.adapterFailure('getSessionStatus', statusResult.error.message));

  if (statusResult.value === 'error') {
    return err(serverErrors.drainFailed(sessionId, 'Session moved to a terminal error state while executing a blocking tool use.'));
  }

  if (statusResult.value !== 'idle') {
    return err(
      serverErrors.drainFailed(sessionId, `Session is still "${statusResult.value}" after every enumerated pending tool call was posted; drain requires confirmed idle.`),
    );
  }

  return ok({ status: 'idle', resolvedToolUseIds });
}
