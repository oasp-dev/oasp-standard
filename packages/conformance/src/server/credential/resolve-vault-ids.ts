import type { AgentDefinition, Credential } from '@oasp/schemas';

/**
 * Re-resolves the `vaultIds` a Session pinned to `definitionVersion`
 * should carry, by matching each `mcp`-type tool grant that requires
 * `auth: 'credential'` against a registered `Credential` whose
 * `mcpServerUrl` matches the grant's `serverUrl` — per
 * `docs/spec/interactions.md` § Stage 1's requirement that `vaultIds`
 * are re-resolved against the *target* version's tool grants, never
 * copied from an outgoing Session.
 *
 * Takes only `{ tools }` — never the full `AgentDefinition` — so every
 * call site is free to pass either the live, current `AgentDefinition`
 * or an immutable `AgentDefinitionVersion` snapshot (see
 * `store/agent-definition-version-store.ts`); both share the same
 * `tools` shape (`agentDefinitionContentSchema`). Every production call
 * site now passes a version snapshot (issue #10) — `create-conversation.ts`,
 * `create-unbound-session.ts`, and `migrate.ts`'s Stage 1 all resolve
 * against the PINNED version's snapshot, never the live, still-editable
 * `AgentDefinition` — closing the version-isolation gap the S0 data
 * model had no snapshot to prevent.
 *
 * Pure given an immutable snapshot of `credentials`; a tool grant with
 * no matching Credential is silently skipped (the reference server
 * does not treat a missing credential as fatal — a profile/deployment
 * enforcing "every credential-requiring grant must resolve" is free to
 * add that check on top).
 */
export function resolveVaultIds(
  definitionVersion: Pick<AgentDefinition, 'tools'>,
  credentials: ReadonlyMap<string, Credential>,
): readonly string[] {
  const vaultIds: string[] = [];
  for (const tool of definitionVersion.tools) {
    if (tool.type !== 'mcp' || tool.auth !== 'credential') continue;
    const match = [...credentials.values()].find((credential) => credential.mcpServerUrl === tool.serverUrl);
    if (match) vaultIds.push(match.id);
  }
  return vaultIds;
}
