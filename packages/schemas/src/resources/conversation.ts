import { z } from 'zod';
import { agentVersionRefSchema } from '../common/agent-version-ref';
import { principalRefSchema } from '../common/principal-ref';
import { resourceType } from '../common/resource-type';
import { scopeSchema } from '../common/scope';

/**
 * The durable, user-facing thread — the "warp" held under tension
 * across the frame while Sessions, the "weft", come and go.
 *
 * A Conversation outlives any single Session: it tracks the
 * `currentSessionId` riding on it today, the `pinnedAgentVersion` that
 * session was minted against, and `previousSessionIds` recording every
 * session this Conversation has ridden on before — the succession
 * `migrate` appends to on each session upgrade.
 *
 * Group (multi-agent) conversations are a v0.1 extension; this schema
 * models the v0 core single-agent case.
 *
 * @see docs/oasp-v0-concept.md § The one structural insight the standard is built on
 * @see docs/oasp-v0-concept.md § Conversation
 */
export const conversationSchema = z
  .object({
    resourceType: resourceType('Conversation'),
    id: z.string().min(1).describe('Unique identifier of this Conversation.'),
    scope: scopeSchema.describe('The generalized-ownership attachment point this Conversation belongs to.'),
    initiatingPrincipal: principalRefSchema.describe('The Principal that started this Conversation.'),
    currentSessionId: z.string().min(1).describe('Identifier of the Session this Conversation currently rides on.'),
    pinnedAgentVersion: agentVersionRefSchema.describe(
      'The immutable AgentDefinition version the current session was minted against.',
    ),
    previousSessionIds: z
      .array(z.string().min(1))
      .describe(
        'Identifiers of every Session this Conversation has ridden on before the current one, oldest first — the lineage `migrate` appends to on each session upgrade.',
      ),
  })
  .describe('The durable thread that survives across the disposable provider Sessions it rides on.')
  .meta({ id: 'Conversation' });

/** Inferred Conversation shape. Always derive from `conversationSchema` — never hand-write. */
export type Conversation = z.infer<typeof conversationSchema>;
