import type { AgentProvider } from '../adapter/agent-provider.types';
import type { Clock } from '../shared/clock.types';
import type { ToolExecutor } from './tool-executor.types';

/** Construction options for {@link import('./create-reference-server').createReferenceServer}. */
export interface CreateReferenceServerOptions {
  readonly provider: AgentProvider;
  readonly clock: Clock;
  /** Executes blocking tool calls on `drain`'s behalf. Defaults to `createEchoToolExecutor()` if omitted. */
  readonly toolExecutor?: ToolExecutor;
  /** The fixed provider-side environment every `AgentDefinition` this server creates is deployed into. Defaults to `'env_default'`. */
  readonly environmentId?: string;
}
