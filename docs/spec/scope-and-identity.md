# Scope and Identity

> Prerequisite reading: [`docs/oasp-v0-concept.md`](../oasp-v0-concept.md)
> § Scope & attachment (generalized ownership) and § Principal (identity
> plane — federation-shaped); [`conversation-and-session.md`](./conversation-and-session.md),
> which carries `Conversation.scope` / `Conversation.initiatingPrincipal`
> as opaque fields and defers their normative treatment here (see its
> [Out of scope here](./conversation-and-session.md#out-of-scope-here)
> section); and [`interactions.md`](./interactions.md), which
> forward-references this document for on-behalf-of attribution (see its
> [Note on audit](./interactions.md#interactions)). This is S2
> ([issue #3](https://github.com/FieldstateNZ/oasp-standard/issues/3)),
> building on the S0 resource schemas
> ([issue #1](https://github.com/FieldstateNZ/oasp-standard/issues/1)):
> [`scopeSchema`](../../packages/schemas/src/common/scope.ts),
> [`principalSchema`](../../packages/schemas/src/resources/principal.ts),
> and [`principalRefSchema`](../../packages/schemas/src/common/principal-ref.ts).
> Read together with [`audit.md`](./audit.md), which specifies how the
> `who` / `scope` attribution defined here surfaces in the audit trail.

This document specifies two things: (1) how a `scope` — the taxonomy an
`AgentDefinition`, `Conversation`, `Credential`, and `AuditEvent` all
attach to — resolves when more than one candidate could apply, and how a
**profile** may narrow that taxonomy without forking the standard; and
(2) the `Principal` claims contract and the on-behalf-of / scope-pinning
containment rule that makes every agent action attributable without
granting it more authority than its pin allows.

## Scope taxonomy and cardinality

Per [`scopeSchema`](../../packages/schemas/src/common/scope.ts), a
`Scope` is `{ level, id }`, where `level` is one of five values:
`tenant`, `workspace`, `user`, `group`, `role`. `AgentDefinition`,
`Conversation`, `Credential`, and `AuditEvent` each carry a `scope`
field of this shape (`agentDefinitionSchema.scope`,
`conversationSchema.scope`, `credentialSchema.scope`,
`auditEventSchema.scope`).

> **Note (schema-comment discrepancy, flagged — not fixed here):**
> `scope.ts`'s own JSDoc says "AgentDefinitions, **sessions**,
> credentials, and audit events all attach to a scope." That is
> inaccurate as written: [`sessionSchema`](../../packages/schemas/src/resources/session.ts)
> has no `scope` field (`id`, `pinnedAgentVersion`, `resources`,
> `vaultIds` only) — it is `Conversation` that carries `scope`, not
> `Session`. This document treats the actual field presence
> (`AgentDefinition`, `Conversation`, `Credential`, `AuditEvent`) as
> authoritative over the comment. Per this slice's constraints, no
> schema file is touched here; flagged in the handback for a doc-comment
> fix.

- A conformant deployment **MUST** support scope attachment at all five
  levels — `tenant | workspace | user | group | role` — unless a
  profile declares a narrower taxonomy (see [Profiles](#profiles)).
- The standard's **default cardinality is N at every level**: many
  scope-attached resources (e.g. many `AgentDefinition`s) may attach to
  the same `Scope`, and a `Principal` **MAY** hold membership
  (`scopeMemberships`) in many scopes at the same level (e.g. two
  `workspace` memberships). A conformant deployment **MUST** permit N at
  every level unless a profile declares a reduced cardinality (see
  [Profiles](#profiles)).

> **Note (two different "role"-shaped things, and a "user" that isn't a
> `Principal` kind):** `level: 'role'` denotes an attachment point —
> a resource scoped to a specific role, the same way it can be scoped to
> a specific workspace. This is a different construct from
> `principalKindSchema`'s `'user' | 'service' | 'agent'` — a scope
> `level: 'user'` names an attachment point keyed to one user's
> individual id (e.g. a personally-owned `AgentDefinition`), not the
> `kind` of the acting party. Likewise, `Scope{level:'role', id}` is a
> different construct from `Principal.roles` — see
> [Principal and the claims contract](#principal-and-the-claims-contract)
> below for that distinction. Keep all three "role"/"user"-flavoured
> concepts separate when reading this document.

## Scope resolution (normative)

When more than one scope-attached resource could apply to a given
`Principal`'s action (e.g. more than one `AgentDefinition` is attached
to a scope the principal belongs to), a server **MUST** resolve exactly
one of them — or explicitly no match — as follows:

1. A server **MUST** filter candidates to those whose `scope`
   (`level` + `id`, exact match) equals an entry in the acting
   `Principal`'s `scopeMemberships` (`principalSchema.scopeMemberships`
   — "the scopes this principal is a member of, used to resolve
   most-specific-scope-wins").
2. Among matching candidates, a server **MUST** select the level with
   the highest precedence present, using the fixed precedence order
   **`user > role > group > workspace > tenant`** — most-specific-scope-wins.
3. If resolution at that level yields exactly one candidate, that
   candidate **MUST** be the result.
4. If resolution at that level yields more than one candidate (a
   precedence tie), a server **MUST NOT** pick among them by an
   arbitrary or implementation-convenient rule (first-in-list,
   most-recently-created, etc.). Resolution **MUST** instead fall to
   **explicit selection**: a caller-supplied input that unambiguously
   identifies exactly one of the tied candidates. A tie takes one of two
   shapes, which need different disambiguators: candidates at the same
   level but *different* scopes (e.g. the principal belongs to two
   workspaces, each with a matching candidate) can be disambiguated by an
   explicit scope parameter; candidates sharing the *same* scope
   (cardinality N at one `{level, id}` — e.g. two `AgentDefinition`s both
   attached to `{role, role_admin}`) cannot, since a scope parameter
   matches both, so the disambiguator **MUST** identify the candidate
   *resource* directly. In either shape the disambiguating input
   **MUST** resolve to exactly one candidate. Its transport is
   implementation-defined; that it **MUST** be required, rather than
   silently defaulted, is normative.
5. If no candidate matches at any level, resolution **MAY** yield "no
   match" by whatever means the deployment defines (e.g. an error, or a
   documented fallback) — the standard does not mandate a specific
   no-match behaviour. A fallback, if one is defined, **MUST NOT**
   resolve to a candidate whose `scope` lies outside the acting
   `Principal`'s `scopeMemberships`: no-match handling may fail, or fall
   back within the principal's memberships, but **MUST NOT** silently
   route an action to a scope that step 1 excluded.

> **Note:** the precedence order `user > role > group > workspace >
> tenant` is a fixed rank list, not a computed containment depth. It
> does not track any real-world nesting a deployment happens to have
> (e.g. workspaces containing groups) — see the worked example below,
> where a `group`-level candidate beats a `workspace`-level one the
> principal is *also* a member of, simply because `group` outranks
> `workspace` in the list. Precedence is deliberately declarative for
> exactly this reason: it does not require a server to know or compute
> any containment relationship between scope levels, only to rank the
> flat `level` values it already has.

### Worked example

Principal Alice (`kind: 'user'`) has:

```
scopeMemberships: [
  { level: 'tenant',    id: 'tenant_acme'   },
  { level: 'workspace', id: 'ws_eng'        },
  { level: 'group',     id: 'group_platform'},
  { level: 'role',      id: 'role_admin'    },
  { level: 'user',      id: 'user_alice'    },
]
roles: ['admin']   // see the note in "Principal and the claims contract" — not an input to this algorithm
```

Five `AgentDefinition`s each attach to exactly one of those five
scopes: `D_tenant`, `D_ws`, `D_group`, `D_role`, `D_user`.

- **Step 1 (filter):** all five match — Alice is a member of every
  scope named.
- **Step 2 (highest precedence present):** of `user, role, group,
  workspace, tenant`, `user` is highest-ranked and present (`D_user`'s
  scope). `D_user` is the sole candidate at that level.
- **Result:** `D_user` resolves, even though `D_ws`, `D_group`,
  `D_role`, and `D_tenant` also matched Alice's memberships. This is
  most-specific-scope-wins: `D_role` (rank 2) is not "more specific" in
  any structural sense than `D_ws` (rank 4) — it simply outranks it in
  the fixed precedence list.

**Removing `D_user` from the candidate set** (e.g. Alice has no
personally-scoped `AgentDefinition`): the highest precedence level
present among the remaining four is `role` → `D_role` resolves, still
beating both `D_group` and `D_ws`, which Alice also belongs to.

**Removing `D_user` and `D_role`** (only `group`-, `workspace`-, and
`tenant`-level candidates remain): the highest present is `group` →
`D_group` resolves, beating `D_ws` even though Alice is a member of
`ws_eng` too. This is the case the note above points at: `group`
outranks `workspace` purely by its position in the fixed precedence
list, not because `group_platform` structurally contains or is contained
by `ws_eng` — the resolver never computes any such relationship.

**Introducing a tie:** suppose two `AgentDefinition`s, `D_role_1` and
`D_role_2`, both attach to `{ level: 'role', id: 'role_admin' }`
(cardinality N at the `role` level, the standard default — see
[Scope taxonomy and cardinality](#scope-taxonomy-and-cardinality)).
Step 2 now yields two candidates at the highest present level. Per
rule 4 above, a server **MUST NOT** silently pick one; it **MUST**
require explicit selection (e.g. the request names `D_role_1`'s id
directly) before resolution can complete.

## Profiles

The standard's scope model is deliberately maximal — five levels,
cardinality N throughout, one fixed precedence order — so that it can
serve deployments the reference implementation never has to think
about. A **profile** is how a specific deployment narrows that model to
what it actually needs, without forking the standard:

- A profile **MAY** constrain which scope levels a deployment exposes
  (e.g. `workspace` only).
- A profile **MAY** constrain cardinality at any level (e.g. exactly
  one `AgentDefinition` per `workspace` scope, rather than N).
- A profile **MAY** override the default precedence order.
- A profile **MUST** declare, in its own documentation, exactly which
  of the above it constrains or overrides relative to the standard's
  defaults. A deployment that behaves like a profile (narrower levels,
  narrower cardinality, different precedence) without declaring so is
  not a conformant profile — it is simply non-conformant, since a
  reader has no way to know the standard's defaults don't hold.

> **Example profile (the reference implementation, documented as one
> instance — never as the standard):** LucidBrain exposes `workspace`
> scope only, with cardinality exactly one `AgentDefinition` per
> workspace — the "one assistant per workspace" model
> (*provenance: `one-assistant-per-workspace-plan.md`*, per
> [`docs/oasp-v0-concept.md` § Scope & attachment](../oasp-v0-concept.md#scope--attachment-generalized-ownership)).
> This is the taxonomy's degenerate case: one level, cardinality one, no
> precedence question ever arises because no more than one candidate can
> ever match. It illustrates that a profile is a genuine *constraint* on
> the standard's default, not a redefinition of it — a server built to
> the LucidBrain profile is conformant to a narrower contract, not to a
> different one.

## Principal and the claims contract

Per [`principalSchema`](../../packages/schemas/src/resources/principal.ts),
a `Principal` has `kind` (`principalKindSchema`:
`'user' | 'service' | 'agent'` — a human, a machine-to-machine caller,
or an agent acting as its own principal), an `identity` claims record,
`scopeMemberships` (used above), and `roles`.

**The claims contract** is what `identity` specifies: the minimum a
conformant implementation **MUST** be able to assert about the acting
party, without prescribing an identity provider.

| Field | Requirement | Description (from `principalIdentitySchema`) |
|---|---|---|
| `subject` | **MUST** be populated (non-empty string) | "Stable subject identifier for this principal, mappable to an OIDC `sub` claim." |
| `issuer` | optional | "Identifier of the asserting identity provider, mappable to an OIDC `iss` claim." |
| `displayName` | optional | "Human-readable display name, if asserted by the identity provider." |
| `email` | optional | "Email address, if asserted by the identity provider." |

- A conformant implementation **MUST** be able to populate, for every
  acting `Principal`, at least `id`, `kind`, and `identity.subject` —
  the minimum needed to answer "who acted" (see
  [`audit.md`](./audit.md#the-conformance-test-normative)).
- A conformant implementation **MUST NOT** require a specific identity
  provider or protocol to populate the claims contract. Any source
  capable of asserting a stable `subject` — a local user table, a SAML
  assertion, an OIDC token, an API-key-derived service identity — is
  sufficient. The contract is shaped to be **OIDC-mappable**
  (`subject`/`issuer` ↔ `sub`/`iss`) without requiring OIDC (see the
  `principalIdentitySchema` doc comment).

> **Note (`roles` vs. `Scope{level:'role'}`, and why this document
> doesn't further specify `roles`):** `principalSchema.roles` is
> described as "IdP-agnostic role names asserted for this principal,
> **independent of scope membership**." That independence is
> deliberate and is preserved here: the [Scope resolution](#scope-resolution-normative)
> algorithm above operates over `scopeMemberships` only — including any
> entries there at `level: 'role'` — and never reads `roles` directly.
> `roles` is a separate assertion a conformant implementation or profile
> **MAY** use for its own authorization decisions (e.g. coarse-grained
> RBAC gating outside of scope resolution); this document does not
> further specify how, since the schema itself scopes `roles` no more
> tightly than "asserted... independent of scope membership."

### OIDC mapping guidance (non-normative)

The claims contract is IdP-agnostic: no requirement above mandates
OIDC. Where an implementation *is* backed by an OIDC-compliant IdP, it
**SHOULD** map claims as follows — guidance, not a conformance
requirement, since OIDC is one conformant claims source among several:

| Contract field | Typical OIDC source | Notes |
|---|---|---|
| `identity.subject` | `sub` | The OIDC spec itself requires `sub` be stable and unique per issuer — the same property the contract requires of `subject`. |
| `identity.issuer` | `iss` | Direct mapping. |
| `identity.displayName` | `name`, or `preferred_username` | Either is a reasonable source; the contract does not distinguish them. |
| `identity.email` | `email` | Implementations relying on this **SHOULD** consider the IdP's `email_verified` claim before treating it as asserted-trustworthy, though the contract itself has no `email_verified` field. |
| `scopeMemberships` | no standard single claim | Commonly sourced from a custom/namespaced claim (e.g. a tenant- or group-membership claim specific to the IdP) and transformed, per-entry, into `{ level, id }` pairs. This transformation is implementation-defined; the standard specifies the target shape (`scopeSchema`), not the source claim. |
| `roles` | commonly a `roles` custom claim, or realm/resource roles in Keycloak-style IdPs | As with `scopeMemberships`, the source claim name and shape vary by IdP; the standard specifies only the target (`string[]`). |

## On-behalf-of and scope-pinning: the containment rule

The concept draft's on-behalf-of model — "every agent action carries
`{ principal, on_behalf_of?, scope }`" — lands on the schemas as
follows (field names are the landed camelCase; `on_behalf_of` above is
the concept draft's snake_case shorthand for the same field):

| Resource | `principal` | `on_behalf_of` (camelCase: `onBehalfOf`) | `scope` |
|---|---|---|---|
| `AuditEvent` | `who.principal` (**MUST** be present) | `who.onBehalfOf` (optional) | `scope` (**MUST** be present) |
| `Credential` | *(the credential's own identity is implicit; it has no `principal` field)* | `onBehalfOf` (optional) | `scope` (**MUST** be present) |
| `Conversation` | `initiatingPrincipal` (**MUST** be present) | *(none — see note below)* | `scope` (**MUST** be present) |

> **Note (`Conversation` has no `onBehalfOf`):** unlike `AuditEvent`
> and `Credential`, `conversationSchema` carries no `onBehalfOf` field —
> only `initiatingPrincipal` and `scope`. The on-behalf-of relationship
> is asserted **per interaction** (in each emitted `AuditEvent.who`),
> not fixed once for the whole `Conversation`. A `Conversation` records
> who started it; it does not itself record who any later interaction
> against it was performed on behalf of.

**The containment rule (normative):** when an interaction is performed
on behalf of another party (`onBehalfOf` present), the accompanying
`scope` **MUST** be the authorization boundary for that interaction —
the **ceiling** on what it may touch. A server **MUST NOT** widen the
delegated interaction's reach by either party's memberships: neither the
`onBehalfOf` party's own `scopeMemberships`/`roles`, **nor the *acting*
principal's** `scopeMemberships`/`roles`, may authorize the interaction
to reach beyond the pinned `scope`. This second exclusion is load-bearing
at enterprise scale, where the acting principal is often a `service`
account holding broad memberships for operational reasons: those
memberships **MUST NOT** leak into what it may do while acting *as* a
pinned member. A server **MAY** further *restrict* a delegated
interaction below the pin (e.g. by the acting principal's own narrower
permissions), but **MUST NOT** exceed it — the effective reach is at most
the pin, never the union of the pin with either party's memberships or
`roles`.

This is stated directly on the landed `Credential` schema itself:
`credentialSchema`'s doc comment reads "`scope` and `onBehalfOf`
together pin who a resolved credential may be used for: **containment
is the pin, never membership**." This document generalizes that same
rule to every on-behalf-of interaction, not just `Credential` use: an
assistant or service acts *as* a member for attribution, but what it
may do is bounded by the pin it was given for that action — never by
the full set of scopes the acted-for member happens to belong to
elsewhere. Without this rule, an assistant scope-pinned to one
workspace could inherit a member's unrelated tenant-admin membership
simply because it is acting "as" that member; the pin exists precisely
to prevent that.

> **Example profile instance:** LucidBrain's per-(agent, member)
> workspace pin is the narrow instance of this mechanism — one scope
> level (`workspace`), one `onBehalfOf` principal per pin
> (*provenance: `assistant-pin.test.ts`*, per
> [`docs/oasp-v0-concept.md` § Principal](../oasp-v0-concept.md#principal-identity-plane--federation-shaped)).
> The standard's containment rule is not scoped to `workspace`-level
> pins or to any one profile — it applies to `onBehalfOf` + `scope`
> wherever they appear together, per the table above.

## The authenticated-actor trust boundary (issue #7 Tranche A)

The sections above specify the `Principal` claims contract and the
containment rule in the abstract; this section specifies the normative
consequence for a server's *implementation* boundary — where the claims
contract is asserted from, and what a server **MUST** do with it before
letting an interaction touch anything.

- A server **MUST NOT** treat a request-body-supplied `{kind, id}` (or
  equivalent bare principal reference asserted directly by the caller)
  as sufficient grounds to authorize a mutating interaction. A server
  **MUST** instead resolve the acting party's claims contract —
  `identity`, `scopeMemberships`, `roles`, and, when delegated, the
  verified `onBehalfOf` + `scopePin` — from its own authentication/
  session layer (a verified token, a server-side session record, an
  mTLS client identity, or equivalent), never from a field the request
  itself supplies unverified. The [reference implementation](../../packages/conformance/README.md)'s
  concrete form of this is `auth/authenticate.ts`: it resolves a
  `principalId` against its own stored `Principal` records
  (`registerPrincipal`'s store) and mints an `AuthenticatedActor`
  (`auth/authenticated-actor.types.ts`) from THAT record — never from
  anything else the caller's request carries. A conformant deployment's
  own authentication layer (OIDC token verification, session cookie
  lookup, etc.) occupies the same role `authenticate()` does here; this
  document does not mandate a specific transport, only that one exists
  and that its resolved claims — not caller-supplied ones — are what
  authorization decisions run against.
- Every mutating interaction (`publish`, `migrate`, `drain`, `stream`,
  `send`, `sendToolResult`, `createConversation`) **MUST** authorize the
  resolved actor against the scope the interaction targets before any
  side effect: for the six interactions that resolve an existing
  resource, that resource's own `scope` (or, for a Session-targeting
  interaction, the `scope` [`audit.md` § Scope provenance](./audit.md#scope-provenance-normative)
  resolves for it); for `createConversation`, the caller-asserted
  `scope` the new `Conversation` would carry, AND the target
  `AgentDefinition`'s own `scope` — an actor cannot launch a Conversation
  from a Definition it cannot otherwise reach, independent of what scope
  it asserted for the Conversation itself.
- Authorization is exact-match against
  [Scope resolution](#scope-resolution-normative)'s equality rule
  (`level` + `id`), never a precedence or containment-by-nesting check:
  an un-delegated actor is authorized iff the target scope is present,
  by exact match, in its `scopeMemberships`. A delegated actor
  (`onBehalfOf` + `scopePin` present) is authorized iff the target scope
  exactly equals `scopePin` — per
  [the containment rule](#on-behalf-of-and-scope-pinning-the-containment-rule)
  above, a server **MUST NOT** consult EITHER party's `scopeMemberships`/`roles`
  once delegated; the pin alone is the ceiling.
- An authorization rejection under this section **MUST** still be
  audited — per [`audit.md`](./audit.md), the required-emission set is
  "every invocation," not "every authorized invocation" — and **MUST
  NOT** be reported as `outcome: 'not_found'`: the actor is asserting a
  scope it has no standing in, not probing for a resource whose
  existence the server should conceal. `outcome: 'failure'` (or an
  equivalent non-`not_found`, non-`success` outcome) is the correct
  shape.

> **Scope of this tranche — reads deferred:** the normative text above
> is scoped to the seven interactions' WRITE paths (the six
> `AuthenticatedActor`-taking interactions plus `createConversation`).
> It does **not** yet specify — and the [reference implementation](../../packages/conformance/README.md)'s
> conformance suite does **not** yet prove — the equivalent containment
> guarantee for read accessors (`getConversation`, `getSession`,
> `listAuditEvents`, `listSessionEvents`, and so on). A server that
> authorizes every write correctly but allows an actor to read a
> resource outside its `scopeMemberships`/`scopePin` is not yet
> excluded by this document. That is deliberately left to a follow-up
> tranche (Tranche B) rather than asserted here without an executable
> check to back it — do not read this section as already covering
> reads.

## Relationship to S1 and to AuditEvent

This document is the full normative treatment
[`conversation-and-session.md`](./conversation-and-session.md) defers
for `Conversation.scope` / `Conversation.initiatingPrincipal`, and that
[`interactions.md`](./interactions.md)'s audit forward-reference note
defers for on-behalf-of attribution. [`audit.md`](./audit.md) builds on
the containment rule specified here: every emitted `AuditEvent` carries a
`who` populated per
[the containment rule](#on-behalf-of-and-scope-pinning-the-containment-rule).
Its `scope`, however, is the scope the interaction *occurred within* —
sourced from the primary resource per
[`audit.md` § Scope provenance](./audit.md#scope-provenance-normative) —
**not** the output of the principal-membership
[Scope resolution](#scope-resolution-normative) algorithm above (that
algorithm selects among candidate resources by membership; it does not
name an emitted event's scope).
