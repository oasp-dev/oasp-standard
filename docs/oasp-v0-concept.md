# OASP — Open Agent Session Protocol · v0 concept draft

*A vendor-neutral standard for agent conversations that outlive their
execution context — across providers, with first-class identity and
audit. Extracted from LucidBrain's managed-agents implementation (the
living reference). FHIR posture: the standard is the product;
implementations — including Loom, the reference server — are conformant,
exchangeable parties. Adoption beyond Fieldstate is welcome, not the
success metric.*

## The one structural insight the standard is built on

**A Conversation is not a Session.** The durable, user-facing thread
(Conversation) is separate from the provider-side execution context it
currently rides on (Session). Sessions are pinned, disposable, and
replaceable substrate; the Conversation survives across them and records
their succession (`previous_session_ids[]`).

On a loom, the *warp* is held under tension across the frame while the
weft comes and goes — the Conversation is the warp, Sessions the weft.
Every distinctive OASP behaviour falls out of this split: version
pinning, seamless upgrade, drain, provider portability. No provider API
offers this resource; every serious agent application hand-builds it.
That is the gap OASP fills.

*(provenance: `conversationsTable` usage in LucidBrain `test-session.ts`
and `migrate-conversation-session.ts`)*

## Resource model (v0)

### AgentDefinition
Canonical, provider-neutral: name, instructions, provider + model, tools,
guardrails. Tools vocabulary: `builtin_toolset` (coding/search/files),
`custom` (name/description/inputSchema), `mcp` (serverUrl, label, auth,
permission policy `always_allow|always_ask`, per-tool allowlist). Two
version pointers: a draft head and a `published_version` — publish is an
explicit interaction, not a save.
*(provenance: `CanonicalAgentDefinition`, `ResolvedCanonicalTool`;
draft/published in `determineTargetVersion`)*

### Deployment
A Definition materialized at a provider: provider name, provider agent
id, environment id, provider version. Idempotent by canonical hash.
*(provenance: `deploy.ts` canonical-hash short-circuit)*

### Conversation
The durable thread. Scope, initiating principal, current `session` ref,
pinned agent version, session lineage. Group (multi-agent) conversations
are a v0.1 extension; single-agent is v0 core.
*(provenance: `conversationsTable`)*

### Session
Provider execution context, created **pinned to an agent version** with
`resources[]` mounted at create (`file`, `memory_store`,
`github_repository`) and `vault_ids[]` (credentials matched to MCP
servers by URL, attached at session creation, never baked into the
definition). Sessions carry nothing forward — remounting is the upgrade
interaction's job.
*(provenance: `createSession` options in `providers/types.ts`)*

### Event
Normalised stream vocabulary all adapters translate into:
`assistant_message_start/_text/_end`, `assistant_thinking`,
`custom_tool_use`, `builtin_tool_use`, `status(running|idle|error)`,
`error(message, recoverable)`. SSE is first-class transport; paginated
`listSessionEvents` is the derive-on-read fallback and audit source.
*(provenance: `NormalisedEvent`, `SessionEvent`)*

### Scope & attachment (generalized ownership)
An AgentDefinition attaches to a **scope**:
`tenant | workspace | user | group | role`, **cardinality N at every
level** — the standard's default. Which levels a deployment exposes and
what cardinality each permits is **profile** territory (the reference
implementation is a profile: workspace scope only, exactly one). Normative
resolution: **most-specific-scope-wins**, precedence
`user > role > group > workspace > tenant`, ties broken by explicit
selection; profiles may override but must declare it.
*(the reference's single-assistant model is the degenerate case —
provenance: `one-assistant-per-workspace-plan.md` generalized)*

### Principal (identity plane — federation-shaped)
First-class, because the standard serves enterprise deployments the
reference implementation ignores. Kinds: `user`, `service`, `agent`.
**Claims contract**: what an implementation must assert about the acting
party (identity, scope memberships, roles) **without prescribing an
IdP** — OIDC-mappable at the claims boundary. **On-behalf-of model**:
every agent action carries `{ principal, on_behalf_of?, scope }`; an
assistant acts *as* a member for attribution while **scope-pinned** —
containment is the pin, never membership.
*(provenance: `one-assistant-per-workspace-plan.md` pin +
`assistant-pin.test.ts`, generalized)*

### AuditEvent (v0 CORE — non-negotiable)
FHIR AuditEvent is the prior art and the posture: an implementation that
cannot answer *"what did the agent do as {member} on {date}"* is
**non-conformant**. Normative minimum per interaction:
`{ who: principal + on_behalf_of, what, scope, when, outcome, refs }`.
Emitted for every mutating interaction. Emission and shape are
conformance; delivery, storage, retention are implementation.

### Credential
Provider-side vaults, attached at session creation, matched to MCP
servers by URL, scope-pinned per on-behalf-of. Never in the Definition.
*(provenance: `vault_ids`, `ensure-assistant-mcp.ts`)*

## Interactions (v0)

| Interaction | Semantics |
|---|---|
| `publish` | Snap published_version forward; live conversations undisturbed (pinned) |
| `migrate` (session upgrade) | Mint session at target version (remount resources/vaults) → transcript-seed with suppression marker → drain to idle → atomic swap + lineage append. Chained migrations don't compound; failed transcript degrades to fresh-start, never fails migration |
| `drain` | Recover a session parked on pending tool calls: enumerate blocking tool_uses, execute, post results, return to idle |
| `stream` | SSE of normalised events until idle/unrecoverable |
| `send` / `sendToolResult` | Message + custom-tool result posting |
| target-version rules | builder → latest; test-session → latest draft; real → published_version; never-published → leave in place |

*(provenance: `migrate-conversation-session.ts`, `drain.ts`, `publish.ts`,
`determineTargetVersion`)*

## Adapter contract

The `AgentProvider` interface is v0's adapter contract:
`ensureEnvironment`, `createAgent/updateAgent/getAgent`, `createSession`,
`sendMessage`, `sendToolResult`, `getSessionStatus`, `listSessionEvents`,
`streamEvents`, `getPendingToolCalls`. Anthropic is the reference
adapter; OpenAI (Responses) and Google slots are reserved by name.
Translation into the normalised vocabulary is explicit, owned, and
*lossy by design*; the standard documents what conformant adapters must
preserve (pinning, pending-tool enumeration, event ordering).
*(provenance: `AgentProvider` in `providers/types.ts`)*

## Conformance

- **Levels**: (1) Client — consumes API + event vocabulary; (2) Server —
  implements resources + interactions; (3) Adapter — maps a provider
  preserving required semantics.
- **Executable conformance kit**: the SDK-against-mock test kit proves
  any server, not just Loom's. Live-provider smoke is a per-adapter
  release ritual.
- **Profiles**: deployments may constrain (LucidBrain's
  one-assistant-per-workspace) without forking the standard.

## The standard/implementation boundary (load-bearing principle)

The reference implementation (LucidBrain) is a **profile**: workspace
scope only, one assistant, single-tenant identity, Anthropic adapter. The
standard inherits none of those constraints. It carries what the
reference gets to ignore: N assistants across tenant/workspace/user/
group/role; enterprise identity via the Principal claims contract
(IdP-agnostic, OIDC-mappable); normative audit. This is why the standard
matters more than any implementation — it is what an enterprise, health-
sector, or third-party deployment conforms *to*. (Principal +
on-behalf-of + scope-pinning + normative AuditEvent make OASP
health-sector-credible essentially for free.)

## Decisions taken

- **"Session" kept** — the Conversation/Session split carries the meaning.
- **Group conversations → v0.1 extension** — single-agent is v0 core.
- **Memory = opaque mounted resource in v0** — a Memory resource is a v1
  candidate once two implementations interoperate on its internals.

## Naming

**OASP — Open Agent Session Protocol.** *Open* signals specification not
product; *Agent Session* names the distinctive axis (the durable-thread-
over-disposable-session lifecycle no other agent protocol models). Loom
is the reference server: *Loom implements OASP.* Home: `oasp.dev`.
