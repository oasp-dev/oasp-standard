import { z } from 'zod';

/**
 * A pin to one specific, immutable version of an AgentDefinition.
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
 * it.
 *
 * Registered under a stable `id` so Conversation and Session reuse one
 * `$defs`/`components.schemas` entry instead of redefining the shape.
 *
 * @see docs/oasp-v0-concept.md § AgentDefinition
 * @see docs/oasp-v0-concept.md § Session
 * @see docs/oasp-v0-concept.md § Interactions (v0) — target-version rules
 */
export const agentVersionRefSchema = z
  .object({
    agentDefinitionId: z.string().min(1).describe('Identifier of the pinned AgentDefinition.'),
    version: z
      .int()
      .positive()
      .describe('The specific, immutable version number of the AgentDefinition being pinned.'),
  })
  .describe('A pin to one immutable version of an AgentDefinition.')
  .meta({ id: 'AgentVersionRef' });

/** Inferred agent version pin shape. Always derive from `agentVersionRefSchema` — never hand-write. */
export type AgentVersionRef = z.infer<typeof agentVersionRefSchema>;
