import { z } from 'zod';
import { principalRefSchema } from '../common/principal-ref';
import { providerSchema } from '../common/provider';
import { resourceType } from '../common/resource-type';
import { scopeSchema } from '../common/scope';

/**
 * A provider-side vault reference, scope-pinned and matched to MCP
 * servers by URL.
 *
 * Credentials are never embedded in an AgentDefinition — a Definition
 * only ever says an MCP tool grant needs `auth: 'credential'`. The
 * actual Credential is resolved at session creation by matching its
 * `mcpServerUrl` against the tool grant's `serverUrl`, and attached to
 * that Session's `vaultIds`. `scope` and `onBehalfOf` together pin who
 * a resolved credential may be used for: containment is the pin,
 * never membership.
 *
 * @see docs/oasp-v0-concept.md § Credential
 * @see docs/oasp-v0-concept.md § Principal (identity plane — federation-shaped)
 */
export const credentialSchema = z
  .object({
    resourceType: resourceType('Credential'),
    id: z.string().min(1).describe('Unique identifier of this Credential.'),
    provider: providerSchema.describe('The provider whose vault holds the referenced secret.'),
    vaultId: z.string().min(1).describe("Reference into the provider's own secret vault. The secret itself is never stored here."),
    mcpServerUrl: z.url().describe('URL of the MCP server this Credential is matched to at session creation.'),
    scope: scopeSchema.describe('The generalized-ownership attachment point this Credential is pinned to.'),
    onBehalfOf: principalRefSchema
      .optional()
      .describe('If present, restricts this Credential to use on behalf of this specific Principal.'),
  })
  .describe('A provider-side vault reference, scope-pinned and matched to MCP servers by URL.')
  .meta({ id: 'Credential' });

/** Inferred Credential shape. Always derive from `credentialSchema` — never hand-write. */
export type Credential = z.infer<typeof credentialSchema>;
