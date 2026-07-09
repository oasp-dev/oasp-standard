import { z } from 'zod';
import { providerSchema } from '../common/provider';
import { scopeSchema } from '../common/scope';

/**
 * Grants one of the provider-hosted builtin toolsets. Not exported: a
 * private building block of {@link agentDefinitionSchema}'s `tools`
 * discriminated union.
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
 * private building block of {@link agentDefinitionSchema}'s `tools`
 * discriminated union.
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
 * the Definition; it is matched to this server by URL and attached at
 * session creation instead. Not exported: a private building block of
 * {@link agentDefinitionSchema}'s `tools` discriminated union.
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
 * a private building block of {@link agentDefinitionSchema}'s `tools`
 * discriminated union.
 */
const mcpToolSchema = z
  .object({
    type: z.literal('mcp').describe('Discriminant identifying this as an MCP server grant.'),
    serverUrl: z.url().describe('URL of the MCP server exposing the tool(s).'),
    label: z.string().min(1).describe('Human-readable label for this MCP server in tool pickers and logs.'),
    auth: mcpAuthSchema,
    permissionPolicy: z
      .enum(['always_allow', 'always_ask'])
      .describe('Whether tool calls to this server run without confirmation, or require per-call approval.'),
    toolAllowlist: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'If present, restricts usable tools on this server to this list; if absent, every tool the server exposes is usable.',
      ),
  })
  .describe(
    'Grants access to tools exposed by a remote MCP server, matched to a Credential by serverUrl at session creation.',
  );

/**
 * The tools vocabulary: a builtin toolset grant, a custom tool
 * definition, or an MCP server grant, discriminated on `type`. Not
 * exported: a private building block of {@link agentDefinitionSchema}.
 */
const toolSchema = z.discriminatedUnion('type', [builtinToolsetToolSchema, customToolSchema, mcpToolSchema]);

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
    instructions: z.string().describe("The agent's system prompt / instructions, verbatim."),
    provider: providerSchema.describe('The provider this Definition targets when deployed.'),
    model: z.string().min(1).describe("The provider's model identifier (e.g. a Claude model name)."),
    tools: z.array(toolSchema).describe('The tools available to the agent: builtin toolsets, custom tools, or MCP server grants.'),
    guardrails: z
      .array(z.string().min(1))
      .describe(
        'Opaque v0 guardrail identifiers/policy names applied to the agent. Structure beyond a name is left to profiles until two implementations interoperate on guardrail internals.',
      ),
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
