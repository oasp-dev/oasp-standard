import type { AgentDefinition, AgentDefinitionVersion, AgentVersionRef } from '@oasp/schemas';
import type { ServerState } from './server-state';

/**
 * Composite key `ServerState.agentDefinitionVersions` is stored under.
 * An `AgentVersionRef.version` is only unique WITHIN one
 * `AgentDefinition` (see `agentVersionRefSchema`) — two different
 * AgentDefinitions may both reach `version: 1` — so the snapshot store
 * keys off the `{ agentDefinitionId, version }` pair, never `version`
 * alone. Not exported: an internal implementation detail of this
 * module's read/write pair, verified indirectly by
 * `agent-definition-version-store.test.ts`'s non-collision case rather
 * than tested in isolation.
 */
function agentDefinitionVersionKey(ref: Pick<AgentVersionRef, 'agentDefinitionId' | 'version'>): string {
  return `${ref.agentDefinitionId}@${ref.version}`;
}

/**
 * Freezes `definition`'s CURRENT content — instructions, provider,
 * model, tools, guardrails (`agentDefinitionContentSchema`'s fields;
 * deliberately excludes `name`, a display label, not versioned content
 * — see that schema's own doc comment) — as an immutable
 * `AgentDefinitionVersion` snapshot under `definition.id` + `version`,
 * recorded into `state.agentDefinitionVersions`.
 *
 * The stored snapshot is a `structuredClone`, never a
 * reference-sharing copy: `definition.tools`/`definition.guardrails`
 * are mutable arrays the live record keeps using after this call
 * (`editAgentDefinitionDraftSetup`'s spread even carries the SAME
 * array instances forward onto the next draft when no override is
 * passed), so assigning them into the snapshot directly would let a
 * later in-place mutation of the live record — or of a sibling
 * version's snapshot — silently rewrite recorded history. The
 * matching read-side clone lives in {@link getAgentDefinitionVersion};
 * see there for why both sides clone. "Immutable" here is a runtime
 * property, not a naming convention.
 *
 * Called at every point a new version NUMBER is minted —
 * `setup/create-agent-definition.ts` (version 1) and
 * `setup/edit-agent-definition-draft.ts` (every later `draftVersion`
 * bump) — so every version ANY Session/Conversation could ever pin to
 * (a real Conversation's `publishedVersion`, or a builder/test
 * session's `draftVersion`) already has a snapshot recorded before
 * anything ever resolves against it. `publish` (`interactions/publish.ts`)
 * deliberately never calls this itself: it only ever moves
 * `publishedVersion` to point at an already-existing `draftVersion`,
 * whose content this function already froze at the moment that version
 * number was minted — see `publish.ts`'s own doc comment for the
 * invariant it asserts instead of re-freezing anything.
 *
 * `version` numbers are append-only per `AgentDefinition`
 * (`draftVersion` only ever increases), so this is always called with
 * a version number that has never been snapshotted before — never a
 * legitimate overwrite of an existing entry.
 */
export function snapshotAgentDefinitionVersion(state: ServerState, definition: AgentDefinition, version: number): void {
  const snapshot: AgentDefinitionVersion = structuredClone({
    resourceType: 'AgentDefinitionVersion',
    agentDefinitionId: definition.id,
    version,
    instructions: definition.instructions,
    provider: definition.provider,
    model: definition.model,
    tools: definition.tools,
    guardrails: definition.guardrails,
  });
  state.agentDefinitionVersions.set(agentDefinitionVersionKey(snapshot), snapshot);
}

/**
 * Reads the immutable content snapshot `ref` pins. This is what
 * `migrate`'s Stage 1 `vaultIds` re-resolution, `drain`'s pre-dispatch
 * tool-call authorization (via `runDrainToIdle`), and initial
 * `createConversation` / `createBuilderSession` / `createTestSession`
 * credential resolution all resolve against now, instead of the live,
 * still-editable `AgentDefinition` — closing issue #10's
 * version-isolation gap. Returns `undefined` only if the version was
 * never minted through `snapshotAgentDefinitionVersion` — an invariant
 * violation callers should treat as a bug, not a legitimate "not yet
 * published" state (see each call site's own defensive check).
 *
 * Returns a `structuredClone` of the stored record, never the stored
 * record itself: this accessor is exposed through the portable
 * `ReferenceServer.getAgentDefinitionVersion` surface to conformance
 * harness code outside this package, and `AgentDefinitionVersion`'s
 * inferred `tools`/`guardrails` arrays are mutable — a consumer
 * pushing into a returned snapshot must corrupt only its own copy,
 * never the store. Cloning on BOTH sides (write above, read here) was
 * chosen over clone-on-write + `readonly` return types deliberately:
 * TypeScript's `readonly` is compile-time-only and cannot bind
 * third-party harness code, whereas the clone makes the store's
 * immutability a runtime fact; the objects are small and this is
 * test-kit code, so the copy cost is irrelevant next to the guarantee.
 */
export function getAgentDefinitionVersion(state: ServerState, ref: AgentVersionRef): AgentDefinitionVersion | undefined {
  const stored = state.agentDefinitionVersions.get(agentDefinitionVersionKey(ref));
  return stored === undefined ? undefined : structuredClone(stored);
}
