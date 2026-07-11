import { z } from 'zod';
import { agentDefinitionContentSchema } from '../common/agent-definition-content';
import { scopeSchema } from '../common/scope';

/**
 * The canonical, provider-neutral definition of an agent: name,
 * instructions, provider + model, tools, and guardrails.
 *
 * Carries two version pointers rather than one: `draftVersion` (the
 * head every edit advances) and `publishedVersion` (the version live
 * conversations pin to, snapped forward only by the explicit `publish`
 * interaction). `publishedVersion` is `null` for a Definition that has
 * never been published — per the v0 target-version rules, a
 * never-published Definition is left in place rather than resolved to
 * a version that doesn't exist.
 *
 * `instructions`/`provider`/`model`/`tools`/`guardrails` — this
 * resource's version-snapshottable content — are spread in from
 * {@link agentDefinitionContentSchema}, the same building block
 * `AgentDefinitionVersion` (`resources/agent-definition-version.ts`)
 * assembles its own immutable per-version snapshot from, so the two
 * can never drift apart field-by-field. This `AgentDefinition`
 * resource is the CURRENT, still-mutable content every edit acts on
 * directly; `AgentDefinitionVersion` is what a `Session`/`Conversation`
 * pin actually resolves against once a version is drafted or
 * published — see that resource's doc comment, and issue #10, for why
 * the two are kept as separate resources rather than this one alone
 * trying to serve both roles.
 *
 * Attaches to a {@link scopeSchema}: which scope levels a deployment
 * actually exposes, and what cardinality each permits, is profile
 * territory (the standard's default is N at every level).
 *
 * @see docs/oasp-v0-concept.md § AgentDefinition
 */
export const agentDefinitionSchema = z
  .object({
    id: z.string().min(1).describe('Unique identifier of this AgentDefinition.'),
    name: z.string().min(1).describe('Human-readable name of the agent.'),
    ...agentDefinitionContentSchema.shape,
    draftVersion: z
      .int()
      .positive()
      .describe('The draft head version number. Every edit to the Definition advances this.'),
    publishedVersion: z
      .int()
      .positive()
      .nullable()
      .describe(
        'The version number live conversations pin to. Null if this Definition has never been published; otherwise only advanced by the explicit publish interaction.',
      ),
    scope: scopeSchema.describe('The generalized-ownership attachment point this Definition belongs to.'),
  })
  .describe('The canonical, provider-neutral definition of an agent.')
  .meta({ id: 'AgentDefinition' });

/** Inferred AgentDefinition shape. Always derive from `agentDefinitionSchema` — never hand-write. */
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
