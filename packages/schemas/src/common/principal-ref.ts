import { z } from 'zod';
import { principalKindSchema } from './principal-kind';

/**
 * A lightweight pointer to a Principal, used wherever a resource needs
 * to name an acting party without embedding the full claims-contract
 * record (identity, scope memberships, roles).
 *
 * This is the shape carried by the on-behalf-of model: every agent
 * action carries `{ principal, on_behalf_of?, scope }`, where both
 * `principal` and `on_behalf_of` are `PrincipalRef`s. An assistant acts
 * *as* a member for attribution while remaining scope-pinned —
 * containment is the pin, never membership.
 *
 * Registered under a stable `id` so Conversation's initiating principal
 * and AuditEvent's `who`/`on_behalf_of` all reuse one
 * `$defs`/`components.schemas` entry.
 *
 * @see docs/oasp-v0-concept.md § Principal (identity plane — federation-shaped)
 */
export const principalRefSchema = z
  .object({
    kind: principalKindSchema.describe('The kind of principal being referenced.'),
    id: z.string().min(1).describe('Identifier of the referenced Principal resource.'),
  })
  .describe('A pointer to a Principal by kind and id, without embedding its full claims-contract record.')
  .meta({ id: 'PrincipalRef' });

/** Inferred principal reference shape. Always derive from `principalRefSchema` — never hand-write. */
export type PrincipalRef = z.infer<typeof principalRefSchema>;
