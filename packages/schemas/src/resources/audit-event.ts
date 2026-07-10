import { z } from 'zod';
import { principalRefSchema } from '../common/principal-ref';
import { scopeSchema } from '../common/scope';

/**
 * `who` performed the interaction: the acting Principal, and
 * optionally the Principal it acted on behalf of. Mirrors the
 * on-behalf-of model's `{ principal, on_behalf_of? }` shape. Not
 * exported: a private building block of {@link auditEventSchema}.
 */
const auditWhoSchema = z.object({
  principal: principalRefSchema.describe('The Principal that performed the interaction.'),
  onBehalfOf: principalRefSchema
    .optional()
    .describe('If the principal acted on behalf of another party (e.g. an assistant acting as a member), that party.'),
});

/**
 * `refs` ties the AuditEvent back to the resources involved. Every
 * field is optional because not every interaction touches every
 * resource type (e.g. `publish` touches a definition but no session).
 * Not exported: a private building block of {@link auditEventSchema}.
 */
const auditRefsSchema = z.object({
  sessionId: z.string().min(1).optional().describe('Identifier of the Session involved, if any.'),
  conversationId: z.string().min(1).optional().describe('Identifier of the Conversation involved, if any.'),
  definitionId: z.string().min(1).optional().describe('Identifier of the AgentDefinition involved, if any.'),
  credentialIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Identifiers of the Credentials attached/used in this interaction, so the trail names which credential — not just that one was attached.'),
});

/**
 * The normative, non-negotiable audit record. FHIR AuditEvent is the
 * prior art and the posture: an implementation that cannot answer
 * *"what did the agent do as {member} on {date}"* is non-conformant.
 *
 * A conformant server emits one AuditEvent for each of the seven v0
 * interactions (`publish`, `createConversation`, `migrate`, `drain`,
 * `stream`, `send`, `sendToolResult`) — including `stream`, which is a
 * read path, audited per the FHIR posture ("what did the agent do, or
 * have observed of it"). `createConversation` is the emission point for
 * a brand-new Conversation's *initial* Session — where `resources[]`
 * are first mounted and `vaultIds[]` first attached — closing what was
 * previously an audited-nowhere gap (`migrate`'s re-attachment was
 * covered; first attachment was not). Emission and shape are
 * conformance; delivery, storage, and retention are implementation.
 *
 * @see docs/oasp-v0-concept.md § AuditEvent (v0 CORE — non-negotiable)
 * @see docs/oasp-v0-concept.md § Interactions (v0)
 * @see docs/spec/interactions.md § createConversation
 */
export const auditEventSchema = z
  .object({
    id: z.string().min(1).describe('Unique identifier of this AuditEvent.'),
    who: auditWhoSchema.describe('The acting principal, and the party it acted on behalf of, if any.'),
    what: z
      .enum(['publish', 'createConversation', 'migrate', 'drain', 'stream', 'send', 'sendToolResult'])
      .describe('Which v0 interaction this AuditEvent records.'),
    scope: scopeSchema.describe('The generalized-ownership attachment point the interaction occurred within.'),
    when: z
      .iso
      .datetime({ offset: true })
      .describe('Timestamp the interaction occurred, as an ISO 8601 date-time. A UTC `Z` designator or a numeric zone offset (e.g. `+12:00`) is accepted, so audit records from any timezone verify against the published schema.'),
    outcome: z.enum(['success', 'failure']).describe('Whether the interaction succeeded or failed.'),
    degraded: z
      .boolean()
      .optional()
      .describe(
        'Whether this interaction completed in a degraded mode that lost continuity it would otherwise have carried — e.g. a `migrate` whose Stage 2 transcript fetch failed and which proceeded with an empty seed instead (docs/spec/interactions.md § Degrade-to-fresh-start on transcript-fetch failure). Optional and additive: omitted (never `false`) for interactions with no degraded mode, and for a migrate that completed a full transcript seed. Present and `true` only on a degraded migrate. Without this field, a degraded migrate and a normal one both emit `outcome: \'success\'` and are indistinguishable in the audit trail — the defect this field exists to close (issue #12).',
      ),
    refs: auditRefsSchema.describe('References to the session, conversation, definition, and/or credentials involved.'),
  })
  .describe('The normative audit record emitted for every mutating interaction.')
  .meta({ id: 'AuditEvent' });

/** Inferred AuditEvent shape. Always derive from `auditEventSchema` — never hand-write. */
export type AuditEvent = z.infer<typeof auditEventSchema>;
