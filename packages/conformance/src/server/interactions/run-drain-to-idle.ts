import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { serverErrors } from '../server-errors';
import type { ToolExecutor } from '../tool-executor.types';
import type { DrainOutcome } from './drain.types';

/**
 * The `drain` normative behaviour itself (`docs/spec/interactions.md`
 * § `drain`), factored out from audit emission so it can be reused
 * both by the client-facing `drainInteraction` (which audits it) and
 * by `migrate`'s Stage 3 (see `migrate.ts`), which per this package's
 * interpretation does not separately audit its internal drain — see
 * the note in `migrate.ts` for that call.
 *
 * Enumerates every pending tool call via `getPendingToolCalls`,
 * executes each via the injected `toolExecutor`, posts every result
 * back via `sendToolResult`, then confirms the session reached
 * `'idle'`. Idempotent: a session with no pending tool calls resolves
 * immediately as a no-op success. Returns failure for ANY terminal
 * status other than `'idle'` — both a terminal `status: 'error'`
 * session and a session still (or again) `'running'` once every
 * enumerated call has been posted (e.g. a chained tool call re-parked
 * it — `docs/spec/adapters.md`'s `getSessionStatus` contract makes this
 * ordinary provider behaviour, not a rare fault). `docs/spec/interactions.md`
 * § `drain` (L355-358, L377-381) is a MUST that success means confirmed
 * `idle`, never merely "no error was seen" — the caller (`drainInteraction`,
 * and `migrate`'s Stage 3) is what turns either failure into an audited
 * outcome / a rejected swap.
 */
export async function runDrainToIdle(
  provider: AgentProvider,
  toolExecutor: ToolExecutor,
  sessionId: string,
): Promise<Result<DrainOutcome, DomainError>> {
  const pendingResult = await provider.getPendingToolCalls(sessionId);
  if (!pendingResult.ok) return err(serverErrors.adapterFailure('getPendingToolCalls', pendingResult.error.message));

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
