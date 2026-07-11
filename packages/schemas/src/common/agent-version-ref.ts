import { z } from 'zod';

/**
 * A pin to one specific version of an AgentDefinition, addressable as
 * an immutable content snapshot — see
 * {@link import('../resources/agent-definition-version').agentDefinitionVersionSchema},
 * the per-version content store `publish` and draft edits populate
 * (issue #10) and that credential/tool-grant resolution reads from.
 * This bare `{ agentDefinitionId, version }` pointer is, on its own,
 * only a stable, comparable value — the immutability guarantee itself
 * lives on `AgentDefinitionVersion`, keyed by exactly this pair, not on
 * this reference type. (Before issue #10 landed, this doc comment
 * asserted content-immutability the data model could not actually back
 * — an `AgentDefinition` stored only its current, still-mutable
 * content plus this integer pointer, with nothing snapshot-addressable
 * behind it. That gap is closed now; this comment describes the
 * mechanism that closes it, not an aspiration.)
 *
 * Sessions are created pinned to an agent version, and Conversations
 * track the pinned agent version their current session was minted
 * against. Pinning is what makes `publish` safe for live conversations
 * (snapping `published_version` forward leaves already-pinned sessions
 * undisturbed) and what `migrate` operates over (minting a new session
 * pinned to a target version).
 *
 * `version` refers to one of an AgentDefinition's two version
 * pointers at the time it was resolved — its draft head or its
 * `published_version` — captured here as a plain integer so the pin
 * is a stable, comparable value independent of which pointer produced
 * it. That integer, together with `agentDefinitionId`, is exactly the
 * key an `AgentDefinitionVersion` snapshot is stored under.
 *
 * Registered under a stable `id` so Conversation and Session reuse one
 * `$defs`/`components.schemas` entry instead of redefining the shape.
 *
 * @see docs/oasp-v0-concept.md § AgentDefinition
 * @see docs/oasp-v0-concept.md § Session
 * @see docs/oasp-v0-concept.md § Interactions (v0) — target-version rules
 * @see docs/spec/target-version-resolution.md
 */
export const agentVersionRefSchema = z
  .object({
    agentDefinitionId: z.string().min(1).describe('Identifier of the pinned AgentDefinition.'),
    version: z
      .int()
      .positive()
      .describe(
        'The version number being pinned; keyed together with agentDefinitionId into an immutable AgentDefinitionVersion content snapshot.',
      ),
  })
  .describe('A pin to one version of an AgentDefinition, keyed into an immutable AgentDefinitionVersion content snapshot.')
  .meta({ id: 'AgentVersionRef' });

/** Inferred agent version pin shape. Always derive from `agentVersionRefSchema` — never hand-write. */
export type AgentVersionRef = z.infer<typeof agentVersionRefSchema>;
