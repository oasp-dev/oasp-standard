import { z } from 'zod';
import { agentDefinitionContentSchema } from '../common/agent-definition-content';
import { agentVersionRefSchema } from '../common/agent-version-ref';
import { resourceType } from '../common/resource-type';

/**
 * An immutable, per-version content snapshot of an `AgentDefinition`:
 * its instructions, provider + model, tools, and guardrails, frozen at
 * the moment the `{ agentDefinitionId, version }` pair it is keyed by
 * came into existence.
 *
 * Closes issue #10's S0 gap: {@link agentVersionRefSchema} already
 * documented a version pin as "specific" and "immutable," but before
 * this resource existed, an `AgentDefinition` stored only its CURRENT,
 * still-mutable content plus two integer pointers (`draftVersion` /
 * `publishedVersion`) — nothing snapshot-addressable backed that
 * immutability claim. A pin's `version` integer alone was "stable and
 * comparable" (per `agentVersionRefSchema`), but resolving it always
 * meant reading whatever the live `AgentDefinition` happened to
 * contain *right now*, regardless of which version was actually
 * pinned. A conformant server now records one `AgentDefinitionVersion`
 * row per version number the instant that number is minted (the
 * reference server does this in
 * `packages/conformance/src/server/setup/create-agent-definition.ts`
 * for `draftVersion: 1`, and in
 * `packages/conformance/src/server/setup/edit-agent-definition-draft.ts`
 * for every later `draftVersion` bump — see
 * `packages/conformance/src/server/store/agent-definition-version-store.ts`).
 * `publish` (`packages/conformance/src/server/interactions/publish.ts`)
 * never freezes new content itself: it only ever moves
 * `publishedVersion` to point at a `draftVersion` whose content this
 * mechanism already froze. Credential/tool-grant resolution that must
 * act "as of" a pinned version — `migrate`'s Stage 1 `vaultIds`
 * re-resolution, `drain`'s pre-dispatch tool-call authorization,
 * initial `createConversation`/builder/test-session credential
 * resolution — now reads from THIS snapshot, never from the live,
 * still-editable `AgentDefinition`.
 *
 * Spreads in `{ agentDefinitionId, version }` from
 * {@link agentVersionRefSchema} directly, rather than redeclaring
 * those two fields: this resource's identity key is, by construction,
 * exactly the pair an `AgentVersionRef` pins — never a superset or a
 * reshaping of it. `AgentVersionRef`'s own wire shape is unchanged by
 * this resource's addition (still a bare `{ agentDefinitionId, version }`
 * pointer); `version` now additionally serves as this resource's own
 * lookup key, in whichever store a server keeps it (the reference
 * server's is an in-memory `Map`, sufficient to prove the invariant —
 * never a production version-content database, see
 * `ServerState.agentDefinitionVersions`'s own doc comment).
 *
 * Deliberately excludes any cryptographic canonicalization or content
 * hash: that is issue #18's scope, coordinated with, but not required
 * by, this resource (see `docs/spec/audit.md`'s note on
 * `evidence.agentVersionRef` remaining a plain pointer, and
 * `deploymentSchema.canonicalHash`, an unrelated deploy-time
 * idempotency key over a DIFFERENT canonicalization target — a
 * provider/environment materialization, not a version's own content
 * identity). This resource's identity is its `{ agentDefinitionId,
 * version }` key alone; proving a provider deployment corresponds to
 * that key is a separate, adapter-profile-level concern this resource
 * does not attempt to settle.
 *
 * @see docs/spec/conversation-and-session.md
 * @see docs/spec/target-version-resolution.md
 */
export const agentDefinitionVersionSchema = z
  .object({
    resourceType: resourceType('AgentDefinitionVersion'),
    ...agentVersionRefSchema.shape,
    ...agentDefinitionContentSchema.shape,
  })
  .describe('An immutable, per-version content snapshot of an AgentDefinition, keyed by { agentDefinitionId, version }.')
  .meta({ id: 'AgentDefinitionVersion' });

/** Inferred AgentDefinitionVersion shape. Always derive from `agentDefinitionVersionSchema` — never hand-write. */
export type AgentDefinitionVersion = z.infer<typeof agentDefinitionVersionSchema>;
