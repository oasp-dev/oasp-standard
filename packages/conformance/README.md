# @oasp/conformance

The executable OASP v0 conformance kit: the `AgentProvider` adapter
contract as a TypeScript interface, a deterministic in-memory mock
implementing it, a minimal conformant reference server built on top of
it, and the Client/Server/Adapter conformance checks that drive both.

**Deterministic. CI-runnable. Zero live keys. Zero network.** Every
piece of state — session ids, event ids, timestamps — comes from an
injected clock and seed, never from `Date.now()`, `Math.random()`, or
an external service. See [Determinism](#determinism) below for how
that's enforced, and `docs/spec/adapters.md` for the normative
adapter contract this package makes executable.

## Layout

```
src/
  adapter/        The AgentProvider interface (agent-provider.types.ts) and its
                   supporting types (CreateSessionOptions, PendingToolCall,
                   SessionStatus, ...) — the executable form of docs/spec/adapters.md.
  mock/            createMockAgentProvider(): a deterministic, in-memory AgentProvider.
                   Seeded reply content, zero-padded lexicographic event ids,
                   induced errors and pending-tool-call scenarios via MockProviderControls.
  server/          createReferenceServer(): a minimal conformant OASP v0 server —
                   the six interactions (publish, migrate, drain, stream, send,
                   sendToolResult) over an injected AgentProvider, holding
                   Conversations/Sessions in memory, emitting AuditEvents.
  conformance/     ConformanceLevel / ConformanceSelfReport types, verifySelfReport(),
                   and the four check suites: checks/server, checks/adapter,
                   checks/client, checks/audit.
  factories/       Test factories (never shared fixtures) for building scenario
                   inputs and a wired-together { server, provider, controls } harness.
  shared/          Result<T, DomainError>, Clock, seeded RNG, zero-padded id generator —
                   the determinism primitives everything else is built on.
```

Every file follows the house TypeScript conventions: one primary
export per file, an `interface` in a sibling `*.types.ts` file for
every service, TSDoc on every exported symbol, `Result<T, DomainError>`
instead of throwing for expected failures, and small (~80-150 line)
files.

## Quick start

```ts
import { createMockAgentProvider, createReferenceServer, createFixedClock } from '@oasp/conformance';

const clock = createFixedClock('2026-01-01T00:00:00.000Z');
const { provider } = createMockAgentProvider({ clock, seed: 1 });
const server = createReferenceServer({ provider, clock });

const definition = await server.createAgentDefinition({
  name: 'Support Assistant',
  instructions: 'Be helpful.',
  provider: 'anthropic',
  model: 'claude-mock',
  tools: [],
  guardrails: [],
  scope: { level: 'workspace', id: 'workspace_1' },
});
await server.publish(definition.id, { principal: { kind: 'user', id: 'user_1' } });
// ... createConversation, send, migrate, drain, stream, sendToolResult
```

Or use the test harness factory that wires a fresh mock provider +
reference server together in one call — the starting point for every
test in this package:

```ts
import { testHarnessFactory } from '@oasp/conformance';

const { server, provider, controls } = testHarnessFactory();
```

## Conformance levels and self-report

Per `docs/oasp-v0-concept.md` § Conformance, there are three levels:
**Client** (consumes the API + Event vocabulary), **Server**
(implements resources + interactions), and **Adapter** (maps a
provider preserving required semantics). Each has an executable check
suite:

| Level | Check suite | Drives |
|---|---|---|
| Client | `runClientChecks(events)` | A consumed event stream — schema validity, S1 termination semantics, lexicographic id ordering. |
| Server | `runServerChecks(server)` | A `ReferenceServer` through the six interactions — version pinning, lineage append-only, migrate non-compounding, drain resolution, send's current-session check. |
| Adapter | `runAdapterChecks(provider)` | An `AgentProvider` directly — version pinning, resource/vault fidelity, pending-tool-call enumeration, event ordering, no-unsolicited-turn-from-seeding, tool-result correlation. |
| Audit | `runAuditChecks(server)` | A `ReferenceServer` through all six required-emission interactions — every one emits a schema-valid `AuditEvent` with the right `what` and scope provenance. |

A server declares which level(s) it claims via `selfReport(): {
levels: ConformanceLevel[] }`. **The kit never trusts this claim** —
`verifySelfReport(selfReport, runners)` runs the actual check suite for
every claimed level and reports any claim that doesn't hold (including
a claimed level with no runner supplied at all, which is treated as an
unverifiable — and therefore failing — claim). See
`src/conformance/verify-self-report.test.ts` for a worked example that
deliberately breaks a server's `migrate` implementation, has it still
self-report `{ levels: ['server'] }`, and shows `verifySelfReport`
catches the false claim.

**Known, deliberate omission:** none of the four check suites require
an `AuditEvent` for initial Conversation/Session creation
(`server.createConversation`). Per `docs/spec/audit.md` § The
credential-attach gap, this is a documented, tracked v0 limitation —
there is no `create*` interaction in the required-emission set to
check against — not an oversight in this kit.

## Determinism

- **Clock:** every timestamp (`Event.at`, `AuditEvent.when`) comes from
  an injected `Clock` (`createFixedClock`), never `Date.now()`. Two
  clocks built from the same start instant produce identical
  timestamps in identical call order.
- **Content:** the mock provider's only source of variety (which of a
  few canned reply templates it picks) comes from a seeded PRNG
  (`createSeededRandom`, mulberry32) — never `Math.random()`. The seed
  never affects control flow, event ordering, or ids — only cosmetic
  text content.
- **Ids:** session/event ids are assigned by monotonic counters
  (`createZeroPaddedIdGenerator`), zero-padded so they satisfy the S1
  lexicographic-ordering guarantee (`docs/spec/interactions.md` §
  `stream`) rather than plain incrementing integers.
- **Verification:** `pnpm test` run twice produces identical pass/fail
  counts; a stronger, byte-for-byte check driving a full
  publish→send→drain→migrate×2→stream scenario through two entirely
  separate process invocations was used during development to confirm
  the emitted `AuditEvent` log and final `Conversation` state are
  byte-identical across runs — not just "the same tests still pass."

## Live-provider smoke: a per-adapter release ritual (NOT run here)

This package's entire suite runs against `createMockAgentProvider` —
no live provider, no network, no API keys, by construction. That
proves an adapter *implementation* is internally coherent against the
`AgentProvider` contract; it cannot prove a real provider integration
works end-to-end against the live API.

For that, `docs/spec/adapters.md` § Live-provider smoke defines a
minimal per-adapter smoke set, run **on release, never in CI, never
per-PR**:

1. **Happy path** — create an agent, create a session, send a message, observe a complete reply.
2. **Stream** — the same happy path consumed via `streamEvents`, confirming live termination on idle.
3. **Tool use** — a message that triggers a tool call, confirming `getPendingToolCalls`/`drain` recovery.
4. **Induced error** — a deliberately invalid call, confirming a structured `error` Event with the correct `recoverable` value.
5. **Context overflow** — a session driven past the provider's context window, confirming a structured, interpretable failure.

This package does not implement, schedule, or invoke any of the five —
by design. Wiring a real credentialed run of this set is future work
for whoever ships the first concrete (e.g. Anthropic) `AgentProvider`
implementation; this kit's job is to define what that run must cover,
not to run it.

## Running the suite

```sh
pnpm --filter @oasp/conformance typecheck
pnpm --filter @oasp/conformance test
```

Both are wired into the repo root's `pnpm -r typecheck` / `pnpm -r
test`, and therefore into `.github/workflows/ci.yml`, automatically —
see that workflow's `Test` step for a short note confirming no network
or live keys are ever required there.
