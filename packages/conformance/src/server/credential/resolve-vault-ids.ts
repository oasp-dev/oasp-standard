import type { AgentDefinition, Credential } from '@oasp/schemas';

/**
 * Re-resolves the `vaultIds` a Session pinned to `definition` should
 * carry, by matching each `mcp`-type tool grant that requires
 * `auth: 'credential'` against a registered `Credential` whose
 * `mcpServerUrl` matches the grant's `serverUrl` — per
 * `docs/spec/interactions.md` § Stage 1's requirement that `vaultIds`
 * are re-resolved against the *target* version's tool grants, never
 * copied from an outgoing Session.
 *
 * Pure given an immutable snapshot of `credentials`; a tool grant with
 * no matching Credential is silently skipped (the reference server
 * does not treat a missing credential as fatal — a profile/deployment
 * enforcing "every credential-requiring grant must resolve" is free to
 * add that check on top).
 */
export function resolveVaultIds(definition: AgentDefinition, credentials: ReadonlyMap<string, Credential>): readonly string[] {
  const vaultIds: string[] = [];
  for (const tool of definition.tools) {
    if (tool.type !== 'mcp' || tool.auth !== 'credential') continue;
    const match = [...credentials.values()].find((credential) => credential.mcpServerUrl === tool.serverUrl);
    if (match) vaultIds.push(match.id);
  }
  return vaultIds;
}
