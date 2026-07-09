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
 * immediately as a no-op success. Returns failure if execution
 * produces a terminal (`status: 'error'`) session — the caller
 * (`drainInteraction`) is what turns that into an audited outcome.
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

  return ok({ status: statusResult.value, resolvedToolUseIds });
}
