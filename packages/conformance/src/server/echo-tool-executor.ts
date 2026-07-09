import { ok } from '../shared/result';
import type { ToolExecutor } from './tool-executor.types';

/**
 * Builds a deterministic {@link ToolExecutor} that "executes" every
 * tool call by echoing back its name and input — never fails, never
 * touches the outside world. The reference server's default executor;
 * good enough to prove `drain`'s enumerate/execute/post-result/confirm
 * loop works, without needing a real tool dispatcher in the
 * conformance kit.
 */
export function createEchoToolExecutor(): ToolExecutor {
  return {
    async execute(toolCall) {
      return ok({ tool: toolCall.name, echoedInput: toolCall.input });
    },
  };
}
