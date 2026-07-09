# Target-version resolution

Every [`migrate`](./interactions.md#migrate-session-upgrade) call needs
a target `AgentVersionRef` — the version to mint a new `Session`
against. This document specifies, unambiguously, how that target is
resolved for every session context.

## The table (normative)

| Session context | Resolves to | Source field on `AgentDefinition` |
|---|---|---|
| **Builder** — an interactive session used to edit/preview an `AgentDefinition` | Latest | `draftVersion` |
| **Test-session** — an ephemeral session spun up to validate a draft before publish | Latest draft | `draftVersion` |
| **Real conversation** — a persisted `Conversation`, where the `AgentDefinition`'s `publishedVersion` is non-null | The current published version | `publishedVersion` |
| **Real conversation**, but the `AgentDefinition`'s `publishedVersion` is `null` (never published) | Leave in place — no target resolved | — |

A conformant resolver **MUST** produce exactly one of two outcomes for
any (session context, `AgentDefinition`) pair:

1. A specific `AgentVersionRef { agentDefinitionId, version }` (see
   [`agentVersionRefSchema`](../../packages/schemas/src/common/agent-version-ref.ts))
   to migrate toward, or
2. **No target** ("leave in place") — `migrate` **MUST** then be a
   successful no-op, never an error and never a partial attempt (see
   [`interactions.md` § Preconditions](./interactions.md#preconditions)).

Resolution **MUST NOT** produce a target version that does not exist.
In particular, resolving a real conversation whose `AgentDefinition`
has a `null` `publishedVersion` **MUST** fall through to "leave in
place." A resolver **MUST NOT** substitute `draftVersion` for a real
conversation merely because `publishedVersion` happens to be unset —
that would pin live, real usage to unpublished, still-changing
content, which is exactly what the draft/published split exists to
prevent (see
[`agentDefinitionSchema`](../../packages/schemas/src/resources/agent-definition.ts):
"a never-published Definition is left in place rather than resolved to
a version that doesn't exist").

**Builder** and **test-session** both resolve to `draftVersion`
because `draftVersion` is, by definition, the only value that is
always "latest": every edit to the Definition advances it (see
[`agentDefinitionSchema`](../../packages/schemas/src/resources/agent-definition.ts)),
so it necessarily leads `publishedVersion` whenever the two differ,
and equals it whenever they don't.

> **Note (a resolution call, flagged for sign-off):** the S0 resource
> schemas — [`Conversation`](../../packages/schemas/src/resources/conversation.ts),
> [`Session`](../../packages/schemas/src/resources/session.ts) — carry
> no explicit `kind`/`purpose` discriminant distinguishing builder /
> test-session / real conversation. "Session context" in the table
> above is therefore a caller-supplied or server-tracked
> classification at the point a `Session` is created or a `migrate`
> sweep runs, not a persisted resource field this document mandates.
> How a conformant server tracks that classification is
> implementation-defined; this table only pins down what each
> classification resolves *to*, matching the concept draft's
> provenance note (`determineTargetVersion` in LucidBrain) and the
> [Interactions (v0) table](../oasp-v0-concept.md#interactions-v0).
> This goes a little beyond what the concept draft spells out and is
> called out again in this slice's handback to the dev lead.

## Relationship to `publish`

Because [`publish`](./interactions.md#publish) only ever advances
`publishedVersion` and never touches an existing `Conversation`,
target-version resolution is what a subsequent, separate
[`migrate`](./interactions.md#migrate-session-upgrade) call uses to
catch a **real conversation** up to that new `publishedVersion`.
Resolution and `publish` together are what make "snap forward, don't
disturb" and "move me forward, on request" two independently
triggerable operations rather than one implicit cascade.
