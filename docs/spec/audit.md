# Audit

> Prerequisite reading: [`docs/oasp-v0-concept.md`](../oasp-v0-concept.md)
> § AuditEvent (v0 CORE — non-negotiable); [`scope-and-identity.md`](./scope-and-identity.md),
> which specifies the `scope` resolution and `onBehalfOf` containment
> rule this document's `who`/`scope` fields depend on; and
> [`interactions.md`](./interactions.md), whose
> [Note on audit (forward reference)](./interactions.md#interactions)
> defers the full normative shape of `AuditEvent` and the
> required-emission set to here. This is S2
> ([issue #3](https://github.com/FieldstateNZ/oasp-standard/issues/3)),
> cross-referencing the landed
> [`auditEventSchema`](../../packages/schemas/src/resources/audit-event.ts)
> / [`AuditEvent.json`](../../schemas/v1alpha1/AuditEvent.json)
> ([issue #1](https://github.com/FieldstateNZ/oasp-standard/issues/1)).

FHIR `AuditEvent` is the prior art and the posture this standard
inherits: an implementation that cannot answer *"what did the agent do
as {principal} on {date}"* is **non-conformant**. This document
specifies (1) the normative minimum shape of an `AuditEvent`, (2) the
required-emission set — which interactions **MUST** produce one, (3)
the conformance test itself, and (4) the emission/delivery boundary.

## AuditEvent normative minimum shape

Per [`auditEventSchema`](../../packages/schemas/src/resources/audit-event.ts)
/ [`AuditEvent.json`](../../schemas/v1alpha1/AuditEvent.json), every
field below is **required** at the top level (`id`, `who`, `what`,
`scope`, `when`, `outcome`, `refs`); the `refs` object's own sub-fields
are individually optional (`refs: {}` is a valid value — see
`audit-event.test.ts`'s "accepts refs with every ref omitted" case).

| Field | Shape | Description |
|---|---|---|
| `id` | `string`, min length 1 | Unique identifier of this `AuditEvent`. |
| `who.principal` | `PrincipalRef` (**MUST** be present) | "The Principal that performed the interaction." |
| `who.onBehalfOf` | `PrincipalRef` (optional) | "If the principal acted on behalf of another party (e.g. an assistant acting as a member), that party." **MUST** be present whenever the interaction was performed on behalf of another `Principal` per [scope-and-identity.md's containment rule](./scope-and-identity.md#on-behalf-of-and-scope-pinning-the-containment-rule); **MUST** be omitted otherwise (there is no "no attribution pin" sentinel value — absence is the sentinel, confirmed by `audit-event.test.ts`). |
| `what` | enum: `publish \| migrate \| drain \| stream \| send \| sendToolResult` | "Which v0 interaction this AuditEvent records." See [Required-emission set](#required-emission-set-conformance-must) below — this enum *is* the required-emission set. |
| `scope` | `Scope` (**MUST** be present) | "The generalized-ownership attachment point the interaction occurred within," populated per [Scope provenance](#scope-provenance-normative) below (this is the scope the interaction *occurred within*, not the output of the principal-membership resolution algorithm). |
| `when` | ISO 8601 date-time, offset required | Timestamp the interaction occurred. A `Z` designator or a numeric zone offset is accepted (see the schema's own field description); a bare date with no time component is rejected (`audit-event.test.ts`: "rejects a when that is not an ISO 8601 date-time"). |
| `outcome` | enum: `success \| failure` | Whether the interaction succeeded or failed. |
| `refs.sessionId` / `refs.conversationId` / `refs.definitionId` | each `string`, min length 1, optional | "References to the session, conversation, and/or definition involved" — each populated only when that resource is relevant to the interaction (e.g. `publish` touches a `definitionId` but no `sessionId`). |

A conformant server **MUST** populate every top-level required field
for each emitted `AuditEvent`. `refs`' individual sub-fields **SHOULD**
be populated whenever the corresponding resource is relevant to the
interaction that produced the event — [interactions.md](./interactions.md)'s
per-interaction **Audit:** lines (reproduced in the table below) name
which `refs` sub-fields apply to each `what` value.

## Scope provenance (normative)

`AuditEvent.scope` is a required field, so every emitted event **MUST**
carry one — including events for interactions against Sessions that are
**not** bound to a `Conversation` (builder / test-sessions), which have
no Conversation `scope` to borrow and whose `Session` resource carries no
`scope` field of its own. This scope is **not** the output of the
[principal-membership resolution algorithm](./scope-and-identity.md#scope-resolution-normative)
(that algorithm selects among candidate *resources* by principal
membership; it does not name the scope an interaction occurred within).
Instead, an emitted `AuditEvent`'s `scope` **MUST** be the scope of the
primary resource the interaction concerns:

| `what` | `scope` **MUST** be |
|---|---|
| `publish` | the target `AgentDefinition`'s `scope`. |
| `migrate` | the target `Conversation`'s `scope`. |
| `send` / `sendToolResult` / `drain` / `stream` on a Session bound to a `Conversation` | that `Conversation`'s `scope`. |
| `send` / `sendToolResult` / `drain` / `stream` on a builder / test-session (no `Conversation`) | the `scope` of the `AgentDefinition` version the Session is pinned to (`Session.pinnedAgentVersion` → `AgentDefinition.scope`). |

This rule is **total**: every `Session` is pinned to an `AgentDefinition`
version via `pinnedAgentVersion`, and every `AgentDefinition` carries a
`scope`, so a defined `scope` exists for every emitted `AuditEvent` — the
required field is never unpopulatable, even for an unbound builder or
test-session.

## Required-emission set (conformance MUST)

**A conformant server MUST emit exactly one `AuditEvent` for every
invocation of each of the six interactions carrying a `what` value in
`auditEventSchema`'s enum:**

`publish`, `migrate`, `drain`, `stream`, `send`, `sendToolResult`.

This list is closed and schema-authoritative: per
[`README.md`'s field-naming convention](./README.md#field-naming-convention)
("when the two disagree... the schema is authoritative — it is
generated code, the concept draft is not"), the same convention applies
here to the *issue's* prose enumeration versus the landed enum. Each
value's emission point is already specified, per-interaction, in
[`interactions.md`](./interactions.md):

| `what` | Interaction | `refs` populated | Audit line (interactions.md) |
|---|---|---|---|
| `publish` | [`publish`](./interactions.md#publish) | `definitionId` | `AuditEvent{ what: 'publish', refs: { definitionId } }` |
| `migrate` | [`migrate`](./interactions.md#migrate-session-upgrade) | `conversationId`, `sessionId` | `AuditEvent{ what: 'migrate', refs: { conversationId, sessionId } }`, emitted whether Stage 2 completed via full transcript seed or degrade-to-fresh-start |
| `drain` | [`drain`](./interactions.md#drain) | `sessionId` | `AuditEvent{ what: 'drain', refs: { sessionId } }` |
| `stream` | [`stream`](./interactions.md#stream) | `sessionId` | `AuditEvent{ what: 'stream', refs: { sessionId } }` — a read path, audited anyway; see [Reconciling](#reconciling-the-issues-prose-against-the-what-enum) below |
| `send` | [`send`](./interactions.md#send) | `sessionId` | `AuditEvent{ what: 'send', refs: { sessionId } }` |
| `sendToolResult` | [`sendToolResult`](./interactions.md#sendtoolresult) | `sessionId` | `AuditEvent{ what: 'sendToolResult', refs: { sessionId } }` |

### Reconciling the issue's prose against the `what` enum

[Issue #3](https://github.com/FieldstateNZ/oasp-standard/issues/3)'s
scope section names the required-emission set in prose as: *"publish,
migrate, drain, send, tool execution, credential attach."* That list
predates — and doesn't exactly match — the landed
`auditEventSchema.what` enum. Reconciling term-by-term:

| Issue's prose term | Landed `what` value(s) | Reasoning |
|---|---|---|
| "publish" | `publish` | Direct match. |
| "migrate" | `migrate` | Direct match. |
| "drain" | `drain` | Direct match. |
| "send" | `send` | Direct match. `sendToolResult` — not separately named in the issue's prose, but present in the enum, [specified in interactions.md](./interactions.md#sendtoolresult) as its own auditable interaction, and covered under "tool execution" below — is included in the required set on schema authority regardless. |
| "tool execution" | `drain` **and** `sendToolResult` | `drain`'s normative behaviour *is* executing pending tool calls and posting results: "For each blocking tool use, the server **MUST** execute it and **MUST** post its result back to the Session (via `sendToolResult`)" ([interactions.md § drain](./interactions.md#drain)). `sendToolResult` is "the same primitive `drain` uses internally... A client posting a tool result directly, and `drain` posting one on a client's behalf, are the same operation from the server's point of view" ([interactions.md § sendToolResult](./interactions.md#sendtoolresult)). So "tool execution" maps to the union of both — which are already independently required by the enum. |
| "credential attach" | **no corresponding `what` value** | See [The credential-attach gap](#the-credential-attach-gap-flagged-for-the-dev-lead) below. |
| *(not named by the issue)* | `stream` | Schema-authoritative inclusion despite the issue's prose omitting it. `stream` is a read path; it is audited anyway per the FHIR `AuditEvent` posture this standard inherits — "what did the agent do (**or have observed of it**) as {member} on {date}," not only "what changed" (verbatim from [interactions.md's forward-reference note](./interactions.md#interactions), consistent with S1). |

The **required-emission set is therefore the full six-value enum** —
`publish | migrate | drain | stream | send | sendToolResult` — not the
issue's five-item prose list. The enum is authoritative; the prose is
reconciled onto it above, term-by-term, with one unmapped remainder.

### The credential-attach gap (flagged for the dev lead)

The issue names *"credential attach"* as a required-emission target.
There is **no `what` enum value for it**, and per this slice's
constraints, no new value is invented and
[`audit-event.ts`](../../packages/schemas/src/resources/audit-event.ts)
is not touched.

The gap is broader than "credential attach" specifically. Per
[`credentialSchema`](../../packages/schemas/src/resources/credential.ts),
credential attachment happens **at Session creation** — a `Credential`
is "resolved at session creation by matching its `mcpServerUrl` against
the tool grant's `serverUrl`, and attached to that Session's
`vaultIds`." Session creation occurs in exactly two normative contexts
in v0:

1. **As Stage 1 of `migrate`** — re-resolving `vaultIds` against the
   target version's `mcp` tool grants ([interactions.md § Stage 1](./interactions.md#stage-1--mint-session-at-target-version)).
   Here the migrate **event** fires — the `migrate` `AuditEvent` covers
   the whole operation, of which minting the Session and attaching its
   `vaultIds` is one stage — but the credential **identity is not
   audited**: `AuditEvent.refs` carries only `sessionId` /
   `conversationId` / `definitionId` and **no** credential/vault
   reference (see [`auditEventSchema`](../../packages/schemas/src/resources/audit-event.ts)),
   so *which* `Credential` was attached is not recoverable from the
   trail. The occurrence has an emission point (`what: 'migrate'`); the
   "which credential, when" question a health-sector auditor asks does
   not — see the release-blocking item below.
2. **The first Session a brand-new `Conversation` ever rides on** —
   this has **no** corresponding interaction anywhere in the v0 set.
   Neither [`docs/oasp-v0-concept.md` § Interactions (v0)](../oasp-v0-concept.md#interactions-v0)
   nor [`interactions.md`](./interactions.md) name a
   `createConversation` / `createSession` interaction at all. So there
   is no `what` value to attach an initial-attachment `AuditEvent` to —
   not because "credential attach" was overlooked specifically, but
   because *initial Session/Conversation creation as a whole* has no
   audited interaction in v0.

This is a cross-slice gap that spans the S0 schema and a not-yet-existing
create interaction, so it cannot be closed inside this audit slice. **The
dev lead's decision for v0:**

- **The required-emission set stands as the closed six-value enum**
  (above). No new `what` value is invented and no S0 schema is edited in
  this slice; "credential attach" is explicitly **not** folded into any
  of the six. Redefining `migrate` to cover zero-stage session creation
  is **rejected** — it would corrupt `migrate`'s meaning ("move onto a
  new version") to cover a case that is not a move from anything.
- **The initial-session-creation credential-attach gap is a tracked,
  v0-release-blocking open item** — not a soft "revisit in v0.1." Because
  the concept draft bills `AuditEvent` as *v0 CORE — non-negotiable* and
  the basis of the standard's health-sector credibility, v0 cannot
  honestly make that claim while the **first** credential attachment of
  every `Conversation` — and initial Session creation as a whole — is
  unaudited. Closing it requires two changes, **both outside this
  slice**: (1) a create interaction (e.g. `createConversation` /
  `createSession`) in the interaction spec to hang an emission point on,
  and (2) a credential/vault reference on `AuditEvent.refs` so *which*
  credential was attached is recoverable (the same `refs` gap the
  migrate case above hits).
- Until both land, the gap is documented here so it is **acknowledged
  and tracked, never silently dropped**. It is carried in the dev lead's
  hand-off as the one substantive open item for the standard's owner to
  schedule as a follow-up.

## The conformance test (normative)

**A conformant server MUST be able to answer, from its emitted
`AuditEvent` history alone, the question "what did {X} do on {date}"**
in both of its two shapes:

- **Direct action** — "what did {X} do on {date}," X acting as itself:
  answerable by filtering emitted `AuditEvent`s where `who.principal`
  matches X's `PrincipalRef` and `when` falls within {date}.
- **Delegated action** — "what did the agent do **as** {member} on
  {date}" (the FHIR-style question the concept draft states verbatim):
  answerable by filtering emitted `AuditEvent`s where `who.onBehalfOf`
  matches {member}'s `PrincipalRef` and `when` falls within {date},
  optionally further narrowed by `who.principal` to identify which
  acting party (which agent/service) performed it.

A server that cannot answer either shape purely from its emitted
`AuditEvent` records — without consulting implementation-specific
storage beyond those records — is **non-conformant**. `who.principal`,
`who.onBehalfOf`, and `when` together **MUST** be sufficient for both.

`refs` extends this from "what happened" to "under what continuity":
correlating an `AuditEvent`'s `refs.conversationId` /
`refs.sessionId` against that `Conversation`'s `pinnedAgentVersion` and
`previousSessionIds` lineage
([conversation-and-session.md § The lineage](./conversation-and-session.md#the-lineage-previoussessionids))
answers not just *that* the agent acted, but *under which
`AgentDefinition` version* — "this is enough to answer, for any point
in a Conversation's history, exactly which agent version produced which
turns — the foundation the... `AuditEvent` normative spec... builds
on," per that document's own forward reference to this one.

## Emission vs. delivery, storage, and retention

- **Emission is conformance:** that an `AuditEvent` conforming to
  [the shape above](#auditevent-normative-minimum-shape) is produced
  for each interaction in the [required-emission set](#required-emission-set-conformance-must)
  is a **MUST**.
- **Shape is conformance:** the fields specified above, and their
  meanings, are a **MUST**.
- **Delivery, storage, and retention are implementation-defined:** the
  standard does not mandate a transport, storage medium, or retention
  period. A server **MUST**, however, retain enough emitted history —
  however it stores it — to truthfully answer
  [the conformance test](#the-conformance-test-normative) for any
  `{principal or member, date}` pair falling within whatever retention
  window the deployment advertises. The standard does not itself pick
  that window's length; it only requires that within it, the
  conformance test is answerable.

## Relationship to S1

This document is the full normative shape
[`interactions.md`](./interactions.md)'s
[audit forward-reference note](./interactions.md#interactions) defers
to S2. Every interaction's **Audit:** line in that document names a
`what` value defined here; this document does not add, remove, or
reinterpret any of those six emission points — it specifies the shape
those events carry and the closed set they belong to.
