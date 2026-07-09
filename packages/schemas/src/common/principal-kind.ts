import { z } from 'zod';

/**
 * The three kinds of acting party OASP recognizes at the identity
 * plane. `user` and `service` are conventional (a human, or a
 * machine-to-machine caller); `agent` lets an AgentDefinition itself be
 * the acting party — e.g. one agent invoking another in a future
 * multi-agent extension.
 *
 * Registered under a stable `id` so both {@link PrincipalRef} and the
 * full `Principal` resource reuse one `$defs`/`components.schemas`
 * entry instead of redefining the enum.
 *
 * @see docs/oasp-v0-concept.md § Principal (identity plane — federation-shaped)
 */
export const principalKindSchema = z
  .enum(['user', 'service', 'agent'])
  .describe('The kind of acting party: a human user, a machine-to-machine service, or an agent acting on its own.')
  .meta({ id: 'PrincipalKind' });

/** Inferred principal kind. Always derive from `principalKindSchema` — never hand-write. */
export type PrincipalKind = z.infer<typeof principalKindSchema>;
