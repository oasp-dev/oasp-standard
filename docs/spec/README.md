# OASP Interaction Spec — Index

Normative behavioural specification for OASP v0: the Conversation ≠
Session model, and the six interactions that operate over it
(`publish`, `migrate`, `drain`, `stream`, `send`, `sendToolResult`).
This is S1 — [issue #2](https://github.com/FieldstateNZ/oasp-standard/issues/2)
— and it builds directly on the S0 resource schemas
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
| [`conversation-and-session.md`](./conversation-and-session.md) | The structural insight: Conversation ≠ Session, the warp/weft framing, the `previousSessionIds` lineage. Read this first — every interaction below falls out of it. |
| [`interactions.md`](./interactions.md) | `publish`, `migrate`, `drain`, `stream`, `send`, `sendToolResult` — full normative behaviour, including sequence diagrams for publish→migrate and drain-on-reopen. |
| [`target-version-resolution.md`](./target-version-resolution.md) | The normative table resolving which `AgentDefinition` version a given session context targets when `migrate` runs. |

Identity, on-behalf-of, and the full `AuditEvent` normative spec are
**out of scope here** — that's S2
([issue #3](https://github.com/FieldstateNZ/oasp-standard/issues/3)).
This spec only notes, per interaction, that it is audited and by which
`what` value; see
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
required semantics) conformance. Level 1 (Client) conformance is
satisfied by consuming the interactions and Event vocabulary as
specified here without needing to implement the server side.
