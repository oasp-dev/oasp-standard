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
  const snapshot: AgentDefinitionVersion = {
    agentDefinitionId: definition.id,
    version,
    instructions: definition.instructions,
    provider: definition.provider,
    model: definition.model,
    tools: definition.tools,
    guardrails: definition.guardrails,
  };
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
 */
export function getAgentDefinitionVersion(state: ServerState, ref: AgentVersionRef): AgentDefinitionVersion | undefined {
  return state.agentDefinitionVersions.get(agentDefinitionVersionKey(ref));
}
