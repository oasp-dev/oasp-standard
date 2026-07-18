# OASP Specification — Index

Normative behavioural specification for OASP v0: the Conversation ≠
Session model and the seven interactions that operate over it
(`publish`, `createConversation`, `migrate`, `drain`, `stream`, `send`,
`sendToolResult`) — S1,
[issue #2](https://github.com/FieldstateNZ/oasp-standard/issues/2),
extended by S4 ([issue #5](https://github.com/FieldstateNZ/oasp-standard/issues/5))
to add `createConversation` and close the credential-attach audit gap
— the identity and audit layer underneath them: scope resolution,
the `Principal` claims contract, on-behalf-of / scope-pinning, and the
normative `AuditEvent` required-emission set — S2,
[issue #3](https://github.com/FieldstateNZ/oasp-standard/issues/3) —
and the adapter contract that maps a provider into all of the above,
plus the executable conformance kit that proves any implementation
against it — S3,
[issue #4](https://github.com/FieldstateNZ/oasp-standard/issues/4).
All three build directly on the S0 resource schemas
([issue #1](https://github.com/FieldstateNZ/oasp-standard/issues/1))
under [`packages/schemas/src/resources/`](../../packages/schemas/src/resources/)
and their generated artifacts under
[`schemas/v1alpha1/`](../../schemas/v1alpha1/) and
[`openapi/`](../../openapi/).

Every normative statement in these documents traces back to
[`docs/oasp-v0-concept.md`](../oasp-v0-concept.md), the authoritative
v0 concept draft. Where a document here makes a resolution the concept
draft left implicit, it says so inline in a **Note** and the call is
also logged in this slice's handback to the dev lead.

## Documents

| Document | Covers |
|---|---|
| [`resources.md`](./resources.md) | The FHIR-style `resourceType` discriminator every resource carries (and every datatype must not), the resource/datatype partition, the unknown-`resourceType` forward-compatibility contract, and how `AuditEvent.what` / `Event.type` compose beneath it. |
| [`conversation-and-session.md`](./conversation-and-session.md) | The structural insight: Conversation ≠ Session, the warp/weft framing, the `previousSessionIds` lineage. Read this first — every interaction below falls out of it. |
| [`interactions.md`](./interactions.md) | `publish`, `createConversation`, `migrate`, `drain`, `stream`, `send`, `sendToolResult` — full normative behaviour, including sequence diagrams for publish→migrate and drain-on-reopen. |
| [`target-version-resolution.md`](./target-version-resolution.md) | The normative table resolving which `AgentDefinition` version a given session context targets when `migrate` runs. |
| [`scope-and-identity.md`](./scope-and-identity.md) | S2. Scope taxonomy and resolution (most-specific-scope-wins), the profile-override mechanism, the `Principal` claims contract (IdP-agnostic, OIDC-mappable), and the on-behalf-of / scope-pinning containment rule. |
| [`audit.md`](./audit.md) | S2. The normative minimum `AuditEvent` shape, the required-emission set reconciled against the landed `what` enum, the conformance test ("what did the agent do as {principal} on {date}"), and the emission-vs-delivery/storage/retention boundary. |
| [`adapters.md`](./adapters.md) | S3. The `AgentProvider` adapter contract — every operation's normative behaviour, the preserve-vs-may-lose boundary (version pinning, pending-tool-call enumeration, event ordering, the normalised Event vocabulary), Anthropic as the reference adapter, OpenAI/Google as reserved slots, and the per-adapter live-provider smoke ritual. Executable counterpart: [`packages/conformance`](../../packages/conformance). |

`interactions.md` notes, per interaction, only that it is audited and
by which `what` value; the full normative shape of `who` / `what` /
`scope` / `when` / `outcome` / `refs`, how on-behalf-of attribution
works, and which interactions **MUST** emit are specified in
[`scope-and-identity.md`](./scope-and-identity.md) and
[`audit.md`](./audit.md) — see
[`packages/schemas/src/resources/audit-event.ts`](../../packages/schemas/src/resources/audit-event.ts)
for the current shape of that record.

## Normative-language conventions

These documents use [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
keywords — **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**
— exactly as defined there, with the
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) convention that
only the capitalized forms carry that special meaning. Each normative
requirement is stated once, with exactly one keyword chosen
deliberately:

- **MUST** / **MUST NOT** — an absolute requirement. A conformant
  server that violates one is non-conformant, full stop.
- **SHOULD** / **SHOULD NOT** — a strong recommendation with a
  legitimate, statable reason to deviate. A server that deviates
  should be able to explain why.
- **MAY** — genuinely optional; a conformant server can go either way
  without affecting conformance.

Non-normative material — background, worked examples, design
rationale, open questions — is marked explicitly and must not be read
as imposing a requirement:

> **Note:** Non-normative explanatory text, like this, is set off in a
> blockquote labelled **Note** or **Rationale**. Nothing inside one of
> these blocks constrains a conformant implementation on its own; if a
> requirement belongs there, it is restated outside the callout with
> its own MUST/SHOULD/MAY.

## Field-naming convention

Field names throughout this spec are the exact camelCase names from
the landed Zod schemas (`previousSessionIds`, `publishedVersion`,
`vaultIds`, `pinnedAgentVersion`, `currentSessionId`, …), never the
snake_case shorthand (`previous_session_ids`, `published_version`, …)
used informally in the concept draft's prose. When the two disagree on
casing, the schema is authoritative — it is generated code, the
concept draft is not.

## Conformance levels

Per the concept draft's [Conformance](../oasp-v0-concept.md#conformance)
section, this document targets Level 2 (Server: implements resources +
interactions) and Level 3 (Adapter: maps a provider preserving
required semantics) conformance — the latter formalized in
[`adapters.md`](./adapters.md). Level 1 (Client) conformance is
satisfied by consuming the interactions and Event vocabulary as
specified here without needing to implement the server side.
[`packages/conformance`](../../packages/conformance) is the executable
kit that checks all three levels deterministically, with no live
provider keys or network access required.
