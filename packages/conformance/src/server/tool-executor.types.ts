import type { PendingToolCall } from '../adapter/pending-tool-call.types';
import type { DomainError } from '../shared/domain-error.types';
import type { Result } from '../shared/result';

/**
 * Executes one blocking tool call on `drain`'s behalf. What a tool
 * actually *does* is application-specific and out of OASP's scope; the
 * reference server only needs something that implements this interface
 * to drive `drain`'s enumerate-execute-post-result loop. Swap this out
 * for a real tool dispatcher in a non-conformance-kit deployment.
 */
export interface ToolExecutor {
  execute(toolCall: PendingToolCall): Promise<Result<unknown, DomainError>>;
}
