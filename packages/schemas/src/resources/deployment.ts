import { z } from 'zod';
import { providerSchema } from '../common/provider';

/**
 * A materialization of an AgentDefinition at a specific provider and
 * environment.
 *
 * Deployments are idempotent by `canonicalHash`: the hash of the
 * Definition's canonical (post-normalization) form. Before creating a
 * new provider-side agent, a conformant server hashes the target
 * Definition and short-circuits to the existing Deployment if a
 * Deployment already exists for that provider/environment with a
 * matching `canonicalHash` — this is what makes repeated `deploy`
 * calls against an unchanged Definition safe to retry.
 *
 * @see docs/oasp-v0-concept.md § Deployment
 */
export const deploymentSchema = z
  .object({
    id: z.string().min(1).describe('Unique identifier of this Deployment.'),
    agentDefinitionId: z.string().min(1).describe('Identifier of the AgentDefinition this Deployment materializes.'),
    provider: providerSchema.describe('The provider this Definition was deployed to.'),
    providerAgentId: z
      .string()
      .min(1)
      .describe("The provider's own identifier for the materialized agent."),
    environmentId: z.string().min(1).describe('Identifier of the environment this Deployment was created in.'),
    providerVersion: z
      .string()
      .min(1)
      .describe("The provider's own version tag for the materialized agent, distinct from the Definition's version pointers."),
    canonicalHash: z
      .string()
      .min(1)
      .describe(
        "Hash of the Definition's canonical (post-normalization) form at deploy time. Two deploy calls against a Definition that hashes the same are idempotent — the existing Deployment is reused rather than re-materialized.",
      ),
  })
  .describe('A materialization of an AgentDefinition at a specific provider and environment, idempotent by canonicalHash.')
  .meta({ id: 'Deployment' });

/** Inferred Deployment shape. Always derive from `deploymentSchema` — never hand-write. */
export type Deployment = z.infer<typeof deploymentSchema>;
