import { z } from 'zod';
import { agentVersionRefSchema } from '../common/agent-version-ref';
import { principalRefSchema } from '../common/principal-ref';
import { resourceType } from '../common/resource-type';
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
 * On a `not_found` `outcome` (see below), the relevant id is still
 * populated here — it is the caller's own asserted target, not new
 * information the event discloses — even though the resource it names
 * never existed. Not exported: a private building block of
 * {@link auditEventSchema}.
 */
const auditRefsSchema = z.object({
  sessionId: z.string().min(1).optional().describe('Identifier of the Session involved, if any (or asserted by the caller, on a not_found outcome).'),
  conversationId: z.string().min(1).optional().describe('Identifier of the Conversation involved, if any (or asserted by the caller, on a not_found outcome).'),
  definitionId: z.string().min(1).optional().describe('Identifier of the AgentDefinition involved, if any (or asserted by the caller, on a not_found outcome).'),
  credentialIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Identifiers of the Credentials attached/used in this interaction, so the trail names which credential — not just that one was attached.'),
});

/**
 * Action-specific evidence beyond bare resource references — answers
 * *what* happened, not just *which resource* was involved. Optional and
 * additive, like `degraded`: v0 currently defines exactly two evidence
 * kinds, both cheap and deterministic to capture; a richer evidence set
 * (tool/grant identity, canonical tool-input digest, approval decision)
 * is [issue #11](https://github.com/FieldstateNZ/oasp-standard/issues/11)'s
 * fuller ask, deferred beyond this slice. Not exported: a private
 * building block of {@link auditEventSchema}.
 */
const auditEvidenceSchema = z.object({
  contentDigest: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A canonical digest of the message content posted by `send`, formatted `sha256:<hex>`. Populated on every `send` AuditEvent regardless of outcome — the caller-supplied content is known whether or not the send itself succeeded — and omitted for every other `what` value. Answers \"exactly what content was sent\" from the trail alone, without re-deriving it from provider-side transcript storage. Distinct from the AgentDefinition version-content hash `docs/spec/audit.md` also discusses: that hash is deferred to issue #18 (no hash algorithm for it is chosen here) — this digests the *message content*, never the *AgentDefinition version*.",
    ),
  agentVersionRef: agentVersionRefSchema
    .optional()
    .describe(
      'The AgentDefinition version pinned — or, for `migrate`, being attempted — at the time of this interaction: a migrate that resolves a target version records that TARGET even when a later stage fails and the Conversation keeps its old pin (the no-op branches record the unchanged pin); every other interaction records the resolved Session/Conversation\'s pinned version. Always the plain `{ agentDefinitionId, version }` pointer, never a content hash of that version (the cryptographic version hash issue #11 also asked for is deferred to issue #18; this reuses the same plain-integer `version` pin `AgentVersionRef` already carries elsewhere, per std-10). Populated whenever the interaction resolves a Session or Conversation, so a pin is knowable; omitted on a `not_found` outcome (no resource was ever resolved to source a pin from) and on `publish`, which advances an AgentDefinition\'s own version pointer directly rather than acting against an already-pinned Session/Conversation.',
    ),
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
 * @see docs/spec/audit.md § Not-found preconditions (issue #11)
 */
export const auditEventSchema = z
  .object({
    resourceType: resourceType('AuditEvent'),
    id: z.string().min(1).describe('Unique identifier of this AuditEvent.'),
    who: auditWhoSchema.describe('The acting principal, and the party it acted on behalf of, if any.'),
    what: z
      .enum(['publish', 'createConversation', 'migrate', 'drain', 'stream', 'send', 'sendToolResult'])
      .describe('Which v0 interaction this AuditEvent records.'),
    scope: scopeSchema
      .optional()
      .describe(
        'The generalized-ownership attachment point the interaction occurred within. Required whenever `outcome` is `success` or `failure` (see the cross-field check this schema enforces below); MAY be omitted when `outcome` is `not_found`, since no primary resource was ever identified to source a scope from. The one exception is `createConversation`, whose `scope` comes from the caller-supplied input rather than an existing resource, so it remains populatable even on a `not_found` outcome — see docs/spec/audit.md § Not-found preconditions.',
      ),
    when: z
      .iso
      .datetime({ offset: true })
      .describe('Timestamp the interaction occurred, as an ISO 8601 date-time. A UTC `Z` designator or a numeric zone offset (e.g. `+12:00`) is accepted, so audit records from any timezone verify against the published schema.'),
    outcome: z
      .enum(['success', 'failure', 'not_found'])
      .describe(
        "Whether the interaction succeeded, failed, or targeted a resource that never existed. `not_found` is its own value — distinct from `failure` — precisely so a probe against a nonexistent id is distinguishable in the trail from an ordinary operational failure (issue #11): a server MUST NOT return before emitting an AuditEvent merely because its precondition check found nothing to act on. See docs/spec/audit.md § Not-found preconditions.",
      ),
    degraded: z
      .boolean()
      .optional()
      .describe(
        'Whether this interaction completed in a degraded mode that lost continuity it would otherwise have carried — e.g. a `migrate` whose Stage 2 transcript fetch failed and which proceeded with an empty seed instead (docs/spec/interactions.md § Degrade-to-fresh-start on transcript-fetch failure). Optional and additive: omitted (never `false`) for interactions with no degraded mode, and for a migrate that completed a full transcript seed. Present and `true` only on a degraded migrate. Without this field, a degraded migrate and a normal one both emit `outcome: \'success\'` and are indistinguishable in the audit trail — the defect this field exists to close (issue #12).',
      ),
    refs: auditRefsSchema.describe('References to the session, conversation, definition, and/or credentials involved.'),
    evidence: auditEvidenceSchema
      .optional()
      .describe(
        'Action-specific evidence for this interaction — currently the `send` content digest and the pinned AgentDefinition version, when resolvable (issue #11, Tranche A). Omitted entirely (never `{}`) when neither sub-field applies, per the same absence-is-the-sentinel convention `degraded` uses.',
      ),
  })
  .check((ctx) => {
    // The cross-field invariant: `scope` is required for a resolved outcome
    // (`success` | `failure`) — docs/spec/audit.md § Scope provenance's
    // totality argument — but MAY be absent on `not_found`, where no primary
    // resource was ever identified to source one from. Enforced here, not
    // left to convention alone, because `emitAuditEvent`'s whole point is
    // that every emitted event is schema-valid by construction — a
    // `success`/`failure` event silently missing `scope` would otherwise slip
    // through unnoticed. The SAME invariant is emitted declaratively into the
    // generated JSON Schema / OpenAPI as the `if`/`else` conditional in this
    // schema's `.meta()` below, so a non-TypeScript consumer validating
    // against the published artifact enforces it too — keep the two in sync.
    if (ctx.value.outcome !== 'not_found' && ctx.value.scope === undefined) {
      ctx.issues.push({
        code: 'custom',
        message: "scope is required unless outcome is 'not_found'",
        input: ctx.value,
        path: ['scope'],
      });
    }
  })
  .describe('The normative audit record emitted for every mutating interaction.')
  .meta({
    id: 'AuditEvent',
    // JSON Schema 2020-12 conditional mirroring the `.check()` above: `scope`
    // is required unless `outcome` is `'not_found'`. Zod's `toJSONSchema`
    // merges extra `.meta()` keys verbatim into the generated output, so this
    // lands in both schemas/v1alpha1/AuditEvent.json and the OpenAPI
    // component without any generator change — the one place the invariant
    // is stated for external validators, since a `.check()` refinement emits
    // nothing. (`then` is deliberately absent: when the `if` matches —
    // outcome IS `not_found` — no extra constraint applies. The `if` repeats
    // `required: ['outcome']` so a hypothetical outcome-less instance falls
    // to the `else` branch rather than vacuously matching.)
    if: { properties: { outcome: { const: 'not_found' } }, required: ['outcome'] },
    else: { required: ['scope'] },
  });

/** Inferred AuditEvent shape. Always derive from `auditEventSchema` — never hand-write. */
export type AuditEvent = z.infer<typeof auditEventSchema>;
