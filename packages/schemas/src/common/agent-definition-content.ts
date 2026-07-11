import { z } from 'zod';
import { providerSchema } from './provider';

/**
 * Grants one of the provider-hosted builtin toolsets. Not exported: a
 * private building block of {@link agentDefinitionContentSchema}'s
 * `tools` discriminated union.
 */
const builtinToolsetToolSchema = z
  .object({
    type: z.literal('builtin_toolset').describe('Discriminant identifying this as a builtin toolset grant.'),
    toolset: z
      .enum(['coding', 'search', 'files'])
      .describe('Which provider-hosted builtin toolset is granted to the agent.'),
  })
  .describe('Grants one of the provider-hosted builtin toolsets (coding, search, files).');

/**
 * Defines a custom, non-MCP tool the agent may call. Not exported: a
 * private building block of {@link agentDefinitionContentSchema}'s
 * `tools` discriminated union.
 */
const customToolSchema = z
  .object({
    type: z.literal('custom').describe('Discriminant identifying this as a custom tool definition.'),
    name: z.string().min(1).describe("Unique name of the custom tool, as the model will call it."),
    description: z
      .string()
      .min(1)
      .describe('Description of the custom tool shown to the model to guide when and how it is invoked.'),
    inputSchema: z
      .record(z.string(), z.unknown())
      .describe("JSON Schema (as a plain object) describing the custom tool's input shape."),
  })
  .describe('Defines a custom, non-MCP tool the agent may call.');

/**
 * Whether an MCP server grant requires a Credential. The credential
 * itself — the provider-side vault reference — is never embedded in
 * the content this schema describes; it is matched to this server by
 * URL and attached at session creation instead. Not exported: a
 * private building block of {@link agentDefinitionContentSchema}'s
 * `tools` discriminated union.
 *
 * @see docs/oasp-v0-concept.md § Credential
 */
const mcpAuthSchema = z
  .enum(['none', 'credential'])
  .describe(
    'Whether this MCP server requires no authentication, or is matched to a Credential by serverUrl at session creation.',
  );

/**
 * Grants access to tools exposed by a remote MCP server. Not exported:
 * a private building block of {@link agentDefinitionContentSchema}'s
 * `tools` discriminated union.
 */
const mcpToolSchema = z
  .object({
    type: z.literal('mcp').describe('Discriminant identifying this as an MCP server grant.'),
    serverUrl: z.url().describe('URL of the MCP server exposing the tool(s).'),
    label: z.string().min(1).describe('Human-readable label for this MCP server in tool pickers and logs.'),
    auth: mcpAuthSchema,
    permissionPolicy: z
      .enum(['always_allow', 'always_ask'])
      .describe(
        'Declared tool-call policy for this server: `always_allow` — execute once the call is otherwise authorized against the grants of the pinned AgentDefinition version; `always_ask` — additionally require a per-call approval before execution. This field states policy intent a conformant server MUST honour; the approval mechanism `always_ask` requires is defined by a separate authorization sub-protocol, not by this field, and a server MUST NOT treat `always_ask` as satisfied merely by executing the call.',
      ),
    toolAllowlist: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Declared restriction a conformant server MUST enforce before dispatch: if present, only these tool names are usable on this server — a server MUST reject any other name pre-dispatch; if absent, every tool the server exposes is usable.',
      ),
  })
  .describe(
    'Grants access to tools exposed by a remote MCP server, matched to a Credential by serverUrl at session creation.',
  );

/**
 * The tools vocabulary: a builtin toolset grant, a custom tool
 * definition, or an MCP server grant, discriminated on `type`. Not
 * exported: a private building block of
 * {@link agentDefinitionContentSchema}.
 */
const toolSchema = z.discriminatedUnion('type', [builtinToolsetToolSchema, customToolSchema, mcpToolSchema]);

/**
 * The version-snapshottable content of an AgentDefinition: its
 * instructions, the provider + model it targets, its granted tools,
 * and its guardrails — everything that materially changes what the
 * agent DOES from one version to the next. Shared between
 * {@link import('../resources/agent-definition').agentDefinitionSchema}
 * (the live, mutable current content every edit acts on) and
 * {@link import('../resources/agent-definition-version').agentDefinitionVersionSchema}
 * (an immutable per-version snapshot of the same shape) so the two
 * field sets can never drift apart from one another — a resource and
 * its own version history are, by construction, the same content
 * shape at two different points in the mutability spectrum.
 *
 * Deliberately excludes `name`: a display label for the
 * AgentDefinition as a whole, not part of what a pinned version
 * reproduces behaviorally (see issue #10's scoping of "the fields at
 * agent-definition.ts:107-115" — `name` is not among them).
 *
 * Not registered under its own `.meta({ id })`: unlike `Scope` /
 * `Provider` / `AgentVersionRef`, this shape is never nested as a
 * sub-object value inside a resource (it is always spread field-by-field
 * into the parent object via `.shape`), so there is no repeated
 * reference for a shared JSON Schema/OpenAPI component to deduplicate —
 * exactly like `agentDefinitionSchema`'s own `tools` union, which has
 * never been registered for the same reason.
 *
 * @see docs/oasp-v0-concept.md § AgentDefinition
 */
export const agentDefinitionContentSchema = z.object({
  instructions: z.string().describe("The agent's system prompt / instructions, verbatim."),
  provider: providerSchema.describe('The provider this agent targets when deployed.'),
  model: z.string().min(1).describe("The provider's model identifier (e.g. a Claude model name)."),
  tools: z.array(toolSchema).describe('The tools available to the agent: builtin toolsets, custom tools, or MCP server grants.'),
  guardrails: z
    .array(z.string().min(1))
    .describe(
      'Opaque v0 guardrail identifiers/policy names applied to the agent. Structure beyond a name is left to profiles until two implementations interoperate on guardrail internals.',
    ),
});

/** Inferred AgentDefinitionContent shape. Always derive from `agentDefinitionContentSchema` — never hand-write. */
export type AgentDefinitionContent = z.infer<typeof agentDefinitionContentSchema>;
