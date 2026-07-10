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
> Extended by S4 ([issue #5](https://github.com/FieldstateNZ/oasp-standard/issues/5))
> to add `createConversation` to the required-emission set and
> `refs.credentialIds` to the normative shape, closing the
> credential-attach gap this document originally tracked as open — see
> [Credential attachment is audited](#credential-attachment-is-audited-createconversation-and-migrate)
> below.

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
`scope`, `when`, `outcome`, `refs`) except `degraded`, which is
optional and additive; the `refs` object's own sub-fields are
individually optional (`refs: {}` is a valid value — see
`audit-event.test.ts`'s "accepts refs with every ref omitted" case).

| Field | Shape | Description |
|---|---|---|
| `id` | `string`, min length 1 | Unique identifier of this `AuditEvent`. |
| `who.principal` | `PrincipalRef` (**MUST** be present) | "The Principal that performed the interaction." |
| `who.onBehalfOf` | `PrincipalRef` (optional) | "If the principal acted on behalf of another party (e.g. an assistant acting as a member), that party." **MUST** be present whenever the interaction was performed on behalf of another `Principal` per [scope-and-identity.md's containment rule](./scope-and-identity.md#on-behalf-of-and-scope-pinning-the-containment-rule); **MUST** be omitted otherwise (there is no "no attribution pin" sentinel value — absence is the sentinel, confirmed by `audit-event.test.ts`). |
| `what` | enum: `publish \| createConversation \| migrate \| drain \| stream \| send \| sendToolResult` | "Which v0 interaction this AuditEvent records." See [Required-emission set](#required-emission-set-conformance-must) below — this enum *is* the required-emission set. |
| `scope` | `Scope` (**MUST** be present) | "The generalized-ownership attachment point the interaction occurred within," populated per [Scope provenance](#scope-provenance-normative) below (this is the scope the interaction *occurred within*, not the output of the principal-membership resolution algorithm). |
| `when` | ISO 8601 date-time, offset required | Timestamp the interaction occurred. A `Z` designator or a numeric zone offset is accepted (see the schema's own field description); a bare date with no time component is rejected (`audit-event.test.ts`: "rejects a when that is not an ISO 8601 date-time"). |
| `outcome` | enum: `success \| failure` | Whether the interaction succeeded or failed. |
| `degraded` | `boolean`, optional | Whether this interaction completed in a degraded mode that lost continuity it would otherwise have carried. **MUST** be omitted (never `false`) when degradation does not apply to the `what` value, or did not occur. Currently populated only by `migrate` — `true` only on the Stage-4 success emission of a migrate whose Stage 2 transcript fetch failed and which proceeded with an empty seed instead; see [interactions.md's Degrade-to-fresh-start on transcript-fetch failure](./interactions.md#degrade-to-fresh-start-on-transcript-fetch-failure-normative). Added to close the gap where a degraded migrate and a normal one emitted the identical `outcome: 'success'` shape (issue #12). |
| `refs.sessionId` / `refs.conversationId` / `refs.definitionId` | each `string`, min length 1, optional | "References to the session, conversation, and/or definition involved" — each populated only when that resource is relevant to the interaction (e.g. `publish` touches a `definitionId` but no `sessionId`). |
| `refs.credentialIds` | `string[]`, each entry min length 1, optional | "Identifiers of the Credentials attached/used in this interaction, so the trail names which credential — not just that one was attached." Populated on `createConversation` (credentials attached at initial creation) and `migrate` (credentials re-attached at Stage 1) — the two points in v0 where `Session.vaultIds` is resolved (see [`credentialSchema`](../../packages/schemas/src/resources/credential.ts)). Omitted, or an empty array, when an interaction attaches no credential. |

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
| `createConversation` | the newly created `Conversation`'s own `scope` (the caller-supplied `scope` the Conversation is created with). |
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
invocation of each of the seven interactions carrying a `what` value in
`auditEventSchema`'s enum:**

`publish`, `createConversation`, `migrate`, `drain`, `stream`, `send`, `sendToolResult`.

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
| `createConversation` | [`createConversation`](./interactions.md#createconversation) | `conversationId`, `sessionId`, `credentialIds` | `AuditEvent{ what: 'createConversation', refs: { conversationId, sessionId, credentialIds } }` — the initial-creation credential-attach emission point; see [Credential attachment is audited](#credential-attachment-is-audited-createconversation-and-migrate) below |
| `migrate` | [`migrate`](./interactions.md#migrate-session-upgrade) | `conversationId`, `sessionId`, `credentialIds` (when a Session is minted) | `AuditEvent{ what: 'migrate', refs: { conversationId, sessionId, credentialIds }, degraded }`, emitted whether Stage 2 completed via full transcript seed or degrade-to-fresh-start. `credentialIds` is populated only when a new Session is actually minted (its `vaultIds` re-resolved); it is omitted on the "leave in place" no-op and on any pre-mint failure, where nothing was re-attached. `degraded: true` is set only on the Stage-4 success emission of a migrate whose Stage 2 transcript fetch failed; omitted on every other migrate outcome — see [Degrade-to-fresh-start on transcript-fetch failure](./interactions.md#degrade-to-fresh-start-on-transcript-fetch-failure-normative) |
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
| "credential attach" | `createConversation` **and** `migrate` (via `refs.credentialIds`) | Closed by S4 ([issue #5](https://github.com/FieldstateNZ/oasp-standard/issues/5)). See [Credential attachment is audited](#credential-attachment-is-audited-createconversation-and-migrate) below — this row previously read "no corresponding `what` value." |
| *(not named by the issue)* | `stream` | Schema-authoritative inclusion despite the issue's prose omitting it. `stream` is a read path; it is audited anyway per the FHIR `AuditEvent` posture this standard inherits — "what did the agent do (**or have observed of it**) as {member} on {date}," not only "what changed" (verbatim from [interactions.md's forward-reference note](./interactions.md#interactions), consistent with S1). |
| *(not named by the issue)* | `createConversation` | Added by S4 specifically to close the "credential attach" row above — the interaction issue #3's prose implied but that did not exist anywhere in v0 at the time. |

The **required-emission set is therefore the full seven-value enum** —
`publish | createConversation | migrate | drain | stream | send |
sendToolResult` — not the issue's five-item prose list. The enum is
authoritative; the prose is reconciled onto it above, term-by-term.
Issue #3's one unmapped remainder — "credential attach" — is no longer
unmapped: S4 ([issue #5](https://github.com/FieldstateNZ/oasp-standard/issues/5))
closed it by landing `createConversation` and `refs.credentialIds`
together; see
[Credential attachment is audited](#credential-attachment-is-audited-createconversation-and-migrate)
immediately below, which replaces what this document used to carry as
"The credential-attach gap."

### Credential attachment is audited (`createConversation` and `migrate`)

> **Status: closed by S4** ([issue #5](https://github.com/FieldstateNZ/oasp-standard/issues/5)).
> This section previously tracked "The credential-attach gap" as a
> tracked, v0-release-blocking open item. It no longer is one. The
> history and reasoning below are preserved because they explain *why*
> the fix takes the shape it does; only the disposition has changed,
> from open to resolved.

The issue names *"credential attach"* as a required-emission target.
Per [`credentialSchema`](../../packages/schemas/src/resources/credential.ts),
credential attachment happens **at Session creation** — a `Credential`
is "resolved at session creation by matching its `mcpServerUrl` against
the tool grant's `serverUrl`, and attached to that Session's
`vaultIds`." Session creation occurs in exactly two normative contexts
in v0, and both are now audited, and both now name *which* `Credential`:

1. **The first Session a brand-new `Conversation` ever rides on** —
   [`createConversation`](./interactions.md#createconversation). Before
   S4, this had **no** corresponding interaction anywhere in the v0
   set — neither [`docs/oasp-v0-concept.md` § Interactions (v0)](../oasp-v0-concept.md#interactions-v0)
   nor [`interactions.md`](./interactions.md) named a
   `createConversation` / `createSession` interaction at all, so there
   was no `what` value to attach an initial-attachment `AuditEvent` to.
   S4 adds `createConversation` to close exactly that: every
   `AuditEvent{ what: 'createConversation' }` carries
   `refs.credentialIds`, naming every `Credential` resolved into the
   new Session's `vaultIds` at creation — the **first** credential
   attachment of every `Conversation`, now audited and named.
2. **Stage 1 of `migrate`** — re-resolving `vaultIds` against the
   target version's `mcp` tool grants ([interactions.md § Stage 1](./interactions.md#stage-1--mint-session-at-target-version)).
   The `migrate` `AuditEvent` already had an emission point before S4 —
   the whole operation, of which minting the Session and attaching its
   `vaultIds` is one stage, was already covered by `what: 'migrate'`.
   What was missing was the credential **identity**: `AuditEvent.refs`
   carried only `sessionId` / `conversationId` / `definitionId`, no
   credential/vault reference, so *which* `Credential` was re-attached
   was not recoverable from the trail. S4 adds `refs.credentialIds` to
   the `migrate` `AuditEvent` too, so the re-attach case now names
   *which* credential exactly as the initial-attach case does — the
   occurrence had an emission point before S4; it now also answers
   "which credential."

**Why this required its own interaction, not a redefinition of
`migrate` (preserved from the original analysis):** the gap was always
broader than "credential attach" specifically — it was that *initial
Session/Conversation creation as a whole* had no audited interaction in
v0. Folding it into `migrate` was considered and rejected: `migrate`
means "move an *existing* Conversation onto a new version"
([interactions.md § migrate](./interactions.md#migrate-session-upgrade):
its own Preconditions require "the target `Conversation` **MUST**
exist"), and a zero-stage "migration" from nothing is not that
operation — redefining it to cover initial creation would corrupt that
meaning. The fix instead required two coordinated changes, landed
together in S4: (1) [`createConversation`](./interactions.md#createconversation)
in the interaction spec, giving initial creation an emission point to
hang an `AuditEvent` on; and (2) `refs.credentialIds` on
[`auditEventSchema`](../../packages/schemas/src/resources/audit-event.ts),
so *which* credential was attached is recoverable for both
`createConversation` and `migrate`. Neither change alone would have
closed the gap — a `what` value with nothing to name the credential, or
a `refs` field with no emission point to attach to on initial creation,
would each have been half a fix.

**What changed, concretely:**

- **S0 schema** ([`auditEventSchema`](../../packages/schemas/src/resources/audit-event.ts)):
  `createConversation` added to `what`'s enum; `refs.credentialIds` —
  `string[]`, each entry min length 1, optional — added to `refs`.
  Regenerated JSON Schema / OpenAPI, fixtures, and drift tests updated
  alongside.
- **S1 interaction spec** ([`interactions.md`](./interactions.md#createconversation)):
  the `createConversation` interaction itself, its normative behaviour
  (mount `resources[]`, resolve+attach `vaultIds[]`, pin to
  `publishedVersion`, reject a never-published definition), and its
  **Audit:** line.
- **S3 conformance kit** (`@oasp/conformance`): the reference server
  emits `AuditEvent{ what: 'createConversation' }` with
  `refs.credentialIds` populated, populates `refs.credentialIds` on the
  `migrate` emission too, and a portable conformance check
  (`checks/audit/run-audit-checks.ts`) asserts both — including a
  negative test proving the check actually fails a server that omits
  the event, or omits `credentialIds`, rather than merely asserting the
  happy path.

The concept draft bills `AuditEvent` as *v0 CORE — non-negotiable* and
the basis of the standard's health-sector credibility. With this
section closed, v0 can now honestly make that claim: "which credential
was attached, when, on whose behalf" is answerable purely from the
emitted `AuditEvent` trail — `who.principal` / `who.onBehalfOf`, `when`,
and `refs.credentialIds` together — for both the first attachment
(`createConversation`) and every re-attachment (`migrate`).

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
to S2, extended by S4 ([issue #5](https://github.com/FieldstateNZ/oasp-standard/issues/5))
to add `createConversation`'s emission point and close the
credential-attach gap. Every interaction's **Audit:** line in that
document names a `what` value defined here; outside of S4's coordinated
addition of `createConversation`, this document does not add, remove,
or reinterpret any of the other six emission points — it specifies the
shape those events carry and the closed set they belong to.
