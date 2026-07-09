import type { AgentDefinition, AgentVersionRef } from '@oasp/schemas';

/**
 * The classification of a Session's purpose, per
 * `docs/spec/target-version-resolution.md`'s note: the S0 schemas
 * carry no persisted `kind`/`purpose` discriminant, so this is a
 * caller-supplied or server-tracked classification at the point a
 * Session is created or a `migrate` sweep runs — not a resource field.
 */
export type SessionContext = 'builder' | 'test-session' | 'real';

/**
 * Resolves the target `AgentVersionRef` a given session context should
 * pin/migrate to, per the normative table in
 * `docs/spec/target-version-resolution.md`. Returns `null` exactly
 * when resolution yields "leave in place" — a real Conversation whose
 * `AgentDefinition` has never been published — which callers (`migrate`)
 * MUST treat as a successful no-op, never an error.
 *
 * Pure: given the same `context` and `definition`, always returns the
 * same result.
 */
export function resolveTargetVersion(context: SessionContext, definition: AgentDefinition): AgentVersionRef | null {
  switch (context) {
    case 'builder':
    case 'test-session':
      // Both resolve to draftVersion: it is, by definition, always "latest" (every edit advances it).
      return { agentDefinitionId: definition.id, version: definition.draftVersion };
    case 'real':
      return definition.publishedVersion === null
        ? null
        : { agentDefinitionId: definition.id, version: definition.publishedVersion };
  }
}
