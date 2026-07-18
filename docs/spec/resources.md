# Resources — the `resourceType` discriminator

> Prerequisite reading: [`docs/proposals/0001-resource-type-discriminator.md`](../proposals/0001-resource-type-discriminator.md),
> the ratified proposal this document makes normative, raised by
> `oasp-java-sdk` — the first external consumer of this standard — after
> building `UnknownAuditEvent`, a hand-rolled fallback for exactly the
> gap this document closes generally. This is S0 follow-up
> ([issue #1](https://github.com/FieldstateNZ/oasp-standard/issues/1)'s
> resource schemas), cross-referencing the shared
> [`resourceType`](../../packages/schemas/src/common/resource-type.ts)
> helper and every resource schema under
> [`packages/schemas/src/resources/`](../../packages/schemas/src/resources/).

FHIR tags every *resource* with a `resourceType` discriminator (but
never an embedded *datatype*), which makes any representation
self-describing: a deserializer can dispatch on the tag, validate that
a payload is the type the caller expected, and a hierarchy can carry a
catch-all for types a reader's version does not yet know. Before this
document, only the `AuditEvent` hierarchy carried a discriminator (its
`what` enum, specified in [`audit.md`](./audit.md)); every other OASP
resource was identifiable only from the caller's expected type or the
endpoint that returned it. This document generalises FHIR's
`resourceType` posture to every OASP resource, closing that gap.

## Every resource carries `resourceType` (normative)

**A conformant representation of an OASP *resource* MUST carry a
`resourceType` field: a string equal, verbatim, to that resource's
PascalCase type name** — `AgentDefinition`, `AgentDefinitionVersion`,
`AuditEvent`, `Conversation`, `Credential`, `Deployment`, `Event`,
`Principal`, `Session`. This is exactly the `id` each resource's Zod
schema is already registered under via `.meta({ id })`
([`get-schema-id.ts`](../../packages/schemas/src/generate/get-schema-id.ts)
reads the same value to name the JSON Schema `$id` and OpenAPI
`components.schemas` key) — `resourceType` is never a separate naming
scheme, only the existing registered name surfaced onto the wire.

`resourceType` **MUST** be declared via the shared
[`resourceType(name)`](../../packages/schemas/src/common/resource-type.ts)
helper, as the first property of the resource's schema, so every
resource declares its discriminator identically rather than
hand-rolling a `z.literal(...)` per resource. `resource-type-guard.test.ts`
in `packages/schemas/src/generate/` enforces this mechanically: it
walks the same [`RESOURCE_SCHEMAS`](../../packages/schemas/src/generate/resource-registry.ts)
registry the JSON Schema / OpenAPI generator does and asserts every
entry's `resourceType` literal equals its registered `.meta({ id })`
name.

| Resource | `resourceType` |
|---|---|
| [`AgentDefinition`](../../packages/schemas/src/resources/agent-definition.ts) | `"AgentDefinition"` |
| [`AgentDefinitionVersion`](../../packages/schemas/src/resources/agent-definition-version.ts) | `"AgentDefinitionVersion"` |
| [`AuditEvent`](../../packages/schemas/src/resources/audit-event.ts) | `"AuditEvent"` |
| [`Conversation`](../../packages/schemas/src/resources/conversation.ts) | `"Conversation"` |
| [`Credential`](../../packages/schemas/src/resources/credential.ts) | `"Credential"` |
| [`Deployment`](../../packages/schemas/src/resources/deployment.ts) | `"Deployment"` |
| [`Event`](../../packages/schemas/src/resources/event.ts) | `"Event"` |
| [`Principal`](../../packages/schemas/src/resources/principal.ts) | `"Principal"` |
| [`Session`](../../packages/schemas/src/resources/session.ts) | `"Session"` |

`Event` is a `z.discriminatedUnion('type', [...])`, not a single
`z.object({...})`: its eight variants (`assistant_message_start`,
`assistant_message_text`, `assistant_message_end`,
`assistant_thinking`, `custom_tool_use`, `builtin_tool_use`, `status`,
`error`) all extend one shared `eventBaseSchema`, and `resourceType`
lives there, so every variant carries `resourceType: 'Event'`
identically — `type` sub-discriminates *within* the `Event` resource
(which kind of stream event this is), exactly as `AuditEvent.what`
sub-discriminates within `AuditEvent` (see below). Every other resource
is a plain `z.object({...})`, with `resourceType` as its first declared
property.

## Datatypes MUST NOT carry `resourceType` (normative)

**An embedded *datatype* — a value that only ever appears nested inside
a resource, never addressable or returned on its own — MUST NOT carry
`resourceType`.** These are dispatched by position (the field name that
embeds them), exactly as in FHIR's resource-vs-datatype distinction.
The v0 datatypes, all under
[`packages/schemas/src/common/`](../../packages/schemas/src/common/),
are:

- [`Scope`](../../packages/schemas/src/common/scope.ts) — the
  generalized-ownership attachment point embedded in `AgentDefinition`,
  `Conversation`, `Credential`, `AuditEvent`, and `Principal`'s
  `scopeMemberships`.
- [`PrincipalRef`](../../packages/schemas/src/common/principal-ref.ts) —
  the lightweight `{ kind, id }` pointer embedded wherever an acting or
  delegated-to party is referenced (`Conversation.initiatingPrincipal`,
  `Credential.onBehalfOf`, `AuditEvent.who.*`).
- [`PrincipalKind`](../../packages/schemas/src/common/principal-kind.ts) —
  the `user | service | agent` enum `Principal.kind` and
  `PrincipalRef.kind` both embed.
- [`AgentVersionRef`](../../packages/schemas/src/common/agent-version-ref.ts) —
  the `{ agentDefinitionId, version }` pin embedded in `Conversation`,
  `Session`, and `AuditEvent.evidence`.
- [`AgentDefinitionContent`](../../packages/schemas/src/common/agent-definition-content.ts) —
  the version-snapshottable content (`instructions`, `provider`,
  `model`, `tools`, `guardrails`) spread into both `AgentDefinition` and
  `AgentDefinitionVersion`.
- [`Provider`](../../packages/schemas/src/common/provider.ts) — the
  `anthropic | openai | google` enum embedded in `Credential`,
  `Deployment`, and `AgentDefinitionContent`.

### `Principal` is a resource, not a datatype

`Principal` **is** a full resource — it carries its own `id`, is
addressable in its own right, and gets `resourceType: "Principal"` —
precisely because it is *referenced* rather than *embedded*: every call
site that needs to name a principal (`Conversation.initiatingPrincipal`,
`Credential.onBehalfOf`, `AuditEvent.who.*`) does so through the
lightweight `PrincipalRef` *datatype* — `{ kind, id }` — never by
embedding the full `Principal` resource inline. `PrincipalRef` MUST NOT
carry `resourceType`, by the datatype rule above; `Principal` MUST, by
the resource rule. The two are deliberately different schemas for
exactly this reason (see
[`principal-ref.ts`](../../packages/schemas/src/common/principal-ref.ts)'s
own doc comment) — this document does not change that split, only
confirms which side of it carries the discriminator.

## Unknown `resourceType` (normative)

**A consumer MUST tolerate an unrecognised `resourceType`** rather than
failing to deserialize a payload outright. A conformant reader
**SHOULD** surface an unrecognised `resourceType` as an opaque
"unknown resource" that preserves the raw payload verbatim, rather than
discarding it — this is the general form of the
`UnknownAuditEvent`-style fallback `oasp-java-sdk` already hand-built
for `AuditEvent.what`, generalised here to every resource's
`resourceType`. This is what makes the discriminator
forward-compatible: a client built against an earlier version of this
standard MUST NOT hard-fail merely because a newer server returns a
resource type the client's version predates — it degrades to an opaque
value the caller can still inspect (e.g. log, pass through, or ignore),
rather than an unhandled deserialization error.

This standard does not prescribe the exact shape of an "unknown
resource" wrapper (a tagged variant, an `unknown`-typed passthrough, a
generic envelope, …) — that is consumer-library territory, exactly as
`UnknownAuditEvent` was `oasp-java-sdk`'s own choice of shape for the
same problem at the `AuditEvent.what` level. The **MUST**/**SHOULD**
above binds the *behaviour* (tolerate; preferably surface losslessly),
not the *representation*.

## `AuditEvent` composes cleanly with `what`

`AuditEvent` is a resource like any other: it carries
`resourceType: "AuditEvent"` exactly as the table above states, and
nothing about adding `resourceType` changes `AuditEvent`'s existing
`what` field or its normative shape, specified in full in
[`audit.md`](./audit.md). `resourceType` identifies the *resource*;
`what` continues to identify *which v0 interaction* this `AuditEvent`
records (`publish | createConversation | migrate | drain | stream |
send | sendToolResult`) — a sub-discriminator **beneath**
`resourceType`, not a replacement for it. `Event.type` is the same
composition one level down in the resource hierarchy: `resourceType:
"Event"` names the resource, `type` names which of the eight stream
event kinds it is.

## Relationship to S0

This document is a follow-up to the S0 resource schemas
([issue #1](https://github.com/FieldstateNZ/oasp-standard/issues/1)),
adding exactly one field — `resourceType` — to each of the nine
registered resources and nothing to any datatype. It does not change
any other field, any resource's `.meta({ id })` value, or the
JSON Schema / OpenAPI generation pipeline beyond what regenerating from
the updated Zod source already produces. Every existing normative
statement elsewhere in this spec ([`audit.md`](./audit.md),
[`interactions.md`](./interactions.md),
[`conversation-and-session.md`](./conversation-and-session.md),
[`scope-and-identity.md`](./scope-and-identity.md),
[`adapters.md`](./adapters.md)) continues to hold unchanged; this
document adds the discriminator requirement on top.
