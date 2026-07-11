import type { AgentDefinition } from '@oasp/schemas';
import type { PendingToolCall } from '../../adapter/pending-tool-call.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { serverErrors } from '../server-errors';

/**
 * Pre-dispatch authorization gate `runDrainToIdle` applies to every
 * enumerated {@link PendingToolCall}, per `docs/spec/interactions.md` §
 * `drain`'s authorization clause (issue #9): a server MUST reject a
 * blocking tool use that is not covered by the Session's pinned
 * `AgentDefinition` version's granted `tools`, before ever invoking the
 * `ToolExecutor` — enforcement belongs at this server layer, before
 * dispatch, never inside the pluggable executor (`tool-executor.types.ts`'s
 * "what a tool does is out of OASP's scope" disclaimer is about
 * behaviour, not about *whether* a call may run at all).
 *
 * Resolution order — deliberately checks `mcpServerUrl` FIRST, before
 * any name-only match: a call that reports an MCP origin is making a
 * provenance claim about itself, and that claim MUST be verified in
 * full rather than let a coincidental `name` collision with an
 * unrelated `custom` grant wave it through unchecked (a call cannot be
 * both a `custom`-tool invocation and MCP-routed at once).
 * 1. If the call reports `mcpServerUrl` (see `pending-tool-call.types.ts`),
 *    it MUST resolve to a granted `mcp` tool by exact `serverUrl` match
 *    — rejected as a wrong-server call if no such grant exists. If a
 *    match is found, its `toolAllowlist` — when present — MUST also
 *    include the call's `name`, or the call is rejected as
 *    allowlist-excluded.
 * 2. Otherwise (no `mcpServerUrl` reported), an exact `custom`-tool
 *    name match is authorized.
 * 3. Otherwise, the call is authorized only if the Definition grants
 *    at least one `builtin_toolset` — OASP v0 does not enumerate the
 *    concrete tool names a provider's builtin toolset exposes (that
 *    vocabulary is provider-specific), so a granted toolset is the
 *    most this layer can verify for such a call; this is a
 *    pre-existing schema-granularity limit this change does not
 *    attempt to solve, not a gap introduced here. Absent that, the
 *    call is rejected as entirely unlisted.
 *
 * `definitionVersion` is the immutable `AgentDefinitionVersion`
 * snapshot the Session's `pinnedAgentVersion` resolves to (see
 * `store/agent-definition-version-store.ts`), not the live, current
 * `AgentDefinition` — issue #10 closed the gap this doc comment used
 * to flag here: before that fix, the S0 schemas snapshotted no
 * Definition's tool grants per historical version, so this function
 * (like `migrate.ts`'s Stage 1 `vaultIds` re-resolution) necessarily
 * read whatever the live `AgentDefinition` happened to hold *right
 * now*, regardless of which version was actually pinned. This
 * function's own parameter type only ever required `{ tools }`
 * (`Pick<AgentDefinition, 'tools'>`), so no signature change was needed
 * to accept a version snapshot in place of the live Definition — only
 * its call sites (`drain.ts`, `migrate.ts`'s Stage 3 via
 * `run-drain-to-idle.ts`) needed rewiring to pass one.
 *
 * Pure given `definitionVersion`/`sessionId`/`toolCall`; never touches
 * `ServerState`, the provider, or the executor itself.
 */
export function authorizePendingToolCall(
  definitionVersion: Pick<AgentDefinition, 'tools'>,
  sessionId: string,
  toolCall: PendingToolCall,
): Result<void, DomainError> {
  if (toolCall.mcpServerUrl !== undefined) {
    const grant = definitionVersion.tools.find((tool) => tool.type === 'mcp' && tool.serverUrl === toolCall.mcpServerUrl);
    if (!grant) {
      return err(
        serverErrors.unauthorizedToolCall(sessionId, toolCall.name, `no granted MCP server matches the reported origin "${toolCall.mcpServerUrl}"`),
      );
    }
    if (grant.type === 'mcp' && grant.toolAllowlist && !grant.toolAllowlist.includes(toolCall.name)) {
      return err(serverErrors.unauthorizedToolCall(sessionId, toolCall.name, `excluded by MCP server "${toolCall.mcpServerUrl}"'s toolAllowlist`));
    }
    return ok(undefined);
  }

  const customMatch = definitionVersion.tools.some((tool) => tool.type === 'custom' && tool.name === toolCall.name);
  if (customMatch) return ok(undefined);

  const builtinGranted = definitionVersion.tools.some((tool) => tool.type === 'builtin_toolset');
  if (builtinGranted) return ok(undefined);

  return err(serverErrors.unauthorizedToolCall(sessionId, toolCall.name, "not present in the pinned AgentDefinition version's granted tools"));
}
