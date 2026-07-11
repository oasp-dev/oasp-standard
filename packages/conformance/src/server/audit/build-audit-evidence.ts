import type { AgentVersionRef, AuditEvent } from '@oasp/schemas';

/**
 * Builds an `AuditEvent.evidence` object from the evidence values a
 * call site has on hand. Exists for the same reason `build-audit-who.ts`
 * does: `tsconfig.base.json` sets `exactOptionalPropertyTypes: true`, so
 * an absent sub-field MUST be omitted entirely (never present as
 * `undefined`), and `evidence` itself MUST be omitted entirely — never
 * `{}` — when neither value applies, per the schema's
 * absence-is-the-sentinel convention (see `audit-event.ts`'s `evidence`
 * doc comment). Centralising that shape once here means every one of
 * the seven interactions' call sites passes plain
 * `string | undefined` / `AgentVersionRef | undefined` values without
 * duplicating the conditional-spread dance.
 */
export function buildAuditEvidence(input: { contentDigest?: string; agentVersionRef?: AgentVersionRef }): AuditEvent['evidence'] {
  const { contentDigest, agentVersionRef } = input;
  if (contentDigest === undefined && agentVersionRef === undefined) return undefined;
  return {
    ...(contentDigest !== undefined ? { contentDigest } : {}),
    ...(agentVersionRef !== undefined ? { agentVersionRef } : {}),
  };
}
