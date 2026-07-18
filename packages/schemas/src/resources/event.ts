import { z } from 'zod';
import { resourceType } from '../common/resource-type';

/**
 * Fields common to every event variant. Every adapter-emitted event
 * needs to be individually addressable and orderable: `listSessionEvents`
 * is paginated (so events need a cursor) and doubles as an audit
 * source, and the Adapter contract requires conformant adapters to
 * preserve event ordering. Not exported: a private building block
 * merged into every branch of {@link eventSchema}'s discriminated
 * union.
 *
 * Carries `resourceType: 'Event'` — every branch of the union is a
 * variant of the single `Event` *resource*, discriminated further by
 * its own `type`; `resourceType` names the resource, `type` names the
 * event kind within it, exactly as `AuditEvent.what` sub-discriminates
 * beneath `AuditEvent.resourceType`.
 *
 * @see docs/oasp-v0-concept.md § Event
 * @see docs/oasp-v0-concept.md § Adapter contract
 */
const eventBaseSchema = z.object({
  resourceType: resourceType('Event'),
  id: z
    .string()
    .min(1)
    .describe(
      'Opaque, order-comparable identifier for this event within its session stream. Used as the listSessionEvents pagination cursor and to establish the event ordering conformant adapters must preserve.',
    ),
  at: z
    .iso
    .datetime({ offset: true })
    .describe('Timestamp the event was emitted, as an ISO 8601 date-time. A UTC `Z` designator or a numeric zone offset (e.g. `+12:00`) is accepted, so implementations in any timezone can emit locally-offset timestamps.'),
});

const assistantMessageStartEventSchema = eventBaseSchema
  .extend({
    type: z.literal('assistant_message_start').describe('Discriminant: the start of a new assistant message.'),
    messageId: z.string().min(1).describe('Identifier of the assistant message beginning.'),
  })
  .describe('Marks the start of a new assistant message.');

const assistantMessageTextEventSchema = eventBaseSchema
  .extend({
    type: z.literal('assistant_message_text').describe('Discriminant: an incremental text chunk of an assistant message.'),
    messageId: z.string().min(1).describe('Identifier of the assistant message this text chunk belongs to.'),
    delta: z.string().describe('The incremental text content of this chunk.'),
  })
  .describe('An incremental text chunk of an in-progress assistant message.');

const assistantMessageEndEventSchema = eventBaseSchema
  .extend({
    type: z.literal('assistant_message_end').describe('Discriminant: the end of an assistant message.'),
    messageId: z.string().min(1).describe('Identifier of the assistant message ending.'),
  })
  .describe('Marks the end of an assistant message.');

const assistantThinkingEventSchema = eventBaseSchema
  .extend({
    type: z.literal('assistant_thinking').describe('Discriminant: an incremental extended-thinking chunk.'),
    delta: z.string().describe('The incremental thinking content of this chunk.'),
  })
  .describe("An incremental chunk of the assistant's extended thinking.");

const customToolUseEventSchema = eventBaseSchema
  .extend({
    type: z.literal('custom_tool_use').describe('Discriminant: an invocation of a custom (non-builtin, non-MCP) tool.'),
    toolUseId: z.string().min(1).describe('Identifier correlating this tool use to its eventual result.'),
    name: z.string().min(1).describe('Name of the custom tool being invoked.'),
    input: z.record(z.string(), z.unknown()).describe('The input arguments passed to the custom tool.'),
  })
  .describe('An invocation of a custom tool defined on the AgentDefinition.');

const builtinToolUseEventSchema = eventBaseSchema
  .extend({
    type: z.literal('builtin_tool_use').describe('Discriminant: an invocation of a provider-hosted builtin tool.'),
    toolUseId: z.string().min(1).describe('Identifier correlating this tool use to its eventual result.'),
    name: z.string().min(1).describe('Name of the builtin tool being invoked.'),
    input: z.record(z.string(), z.unknown()).describe('The input arguments passed to the builtin tool.'),
  })
  .describe('An invocation of a provider-hosted builtin tool.');

const statusEventSchema = eventBaseSchema
  .extend({
    type: z.literal('status').describe('Discriminant: a session status transition.'),
    status: z.enum(['running', 'idle', 'error']).describe("The session's new status."),
  })
  .describe("A transition in the session's status.");

const errorEventSchema = eventBaseSchema
  .extend({
    type: z.literal('error').describe('Discriminant: an error condition.'),
    message: z.string().min(1).describe('Human-readable description of the error.'),
    recoverable: z
      .boolean()
      .describe('Whether the session can continue after this error (e.g. via drain) or is terminally failed.'),
  })
  .describe('An error condition encountered while executing the session.');

/**
 * The normalised event vocabulary every adapter translates
 * provider-native streaming output into. This is the lossy-by-design
 * translation boundary the Adapter contract calls out: adapters must
 * preserve pending-tool enumeration and event ordering, but the
 * provider's native event shapes are not preserved verbatim.
 *
 * SSE is the first-class transport for this vocabulary; paginated
 * `listSessionEvents` is the derive-on-read fallback and doubles as
 * the audit source.
 *
 * @see docs/oasp-v0-concept.md § Event
 * @see docs/oasp-v0-concept.md § Adapter contract
 */
export const eventSchema = z
  .discriminatedUnion('type', [
    assistantMessageStartEventSchema,
    assistantMessageTextEventSchema,
    assistantMessageEndEventSchema,
    assistantThinkingEventSchema,
    customToolUseEventSchema,
    builtinToolUseEventSchema,
    statusEventSchema,
    errorEventSchema,
  ])
  .describe('A normalised session-stream event, discriminated by `type`.')
  .meta({ id: 'Event' });

/** Inferred Event shape (a discriminated union over `type`). Always derive from `eventSchema` — never hand-write. */
export type Event = z.infer<typeof eventSchema>;
