import { z } from 'zod';

/**
 * The five levels an OASP scope may attach at, from broadest to
 * narrowest. Not exported: it only exists to build {@link scopeSchema}.
 *
 * Normative resolution order when scopes overlap is
 * `user > role > group > workspace > tenant` (most-specific-scope-wins),
 * with ties broken by explicit selection. Profiles may override this
 * but must declare it.
 *
 * @see docs/oasp-v0-concept.md § Scope & attachment (generalized ownership)
 */
const scopeLevelSchema = z.enum(['tenant', 'workspace', 'user', 'group', 'role']);

/**
 * A generalized-ownership attachment point. AgentDefinitions,
 * Conversations, Credentials, and AuditEvents all attach to a scope
 * rather than a hardcoded owner type. (A Session does not carry a scope
 * of its own — it inherits its Conversation's, or its pinned
 * AgentDefinition's, per the audit scope-provenance rule.)
 *
 * The standard's default cardinality is **N at every level** — e.g. many
 * AgentDefinitions may attach to the same workspace. Which levels a given
 * deployment actually exposes, and what cardinality it permits, is
 * profile territory: the reference implementation (LucidBrain) is a
 * profile that only exposes `workspace` scope with cardinality one.
 *
 * Registered under a stable `id` so every resource that carries a scope
 * (AgentDefinition, Conversation, Credential, AuditEvent, …) reuses one
 * `$defs`/`components.schemas` entry instead of redefining the shape.
 *
 * @see docs/oasp-v0-concept.md § Scope & attachment (generalized ownership)
 */
export const scopeSchema = z
  .object({
    level: scopeLevelSchema.describe(
      'Which level of the tenant/workspace/user/group/role taxonomy this attachment point is at.',
    ),
    id: z
      .string()
      .min(1)
      .describe('Identifier of the scoped entity (the tenant id, workspace id, user id, group id, or role id).'),
  })
  .describe('A generalized-ownership attachment point: a taxonomy level plus the identifier at that level.')
  .meta({ id: 'Scope' });

/** Inferred scope shape. Always derive from `scopeSchema` — never hand-write. */
export type Scope = z.infer<typeof scopeSchema>;
