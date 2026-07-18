import { z } from 'zod';
import { principalKindSchema } from '../common/principal-kind';
import { resourceType } from '../common/resource-type';
import { scopeSchema } from '../common/scope';

/**
 * The claims-contract identity assertion: what an implementation must
 * assert about the acting party without prescribing an identity
 * provider. Shaped to be OIDC-mappable at the claims boundary
 * (`subject`/`issuer` map to `sub`/`iss`) without requiring OIDC.
 * Not exported: a private building block of {@link principalSchema}.
 */
const principalIdentitySchema = z.object({
  subject: z
    .string()
    .min(1)
    .describe('Stable subject identifier for this principal, mappable to an OIDC `sub` claim.'),
  issuer: z
    .string()
    .min(1)
    .optional()
    .describe('Identifier of the asserting identity provider, mappable to an OIDC `iss` claim.'),
  displayName: z.string().min(1).optional().describe('Human-readable display name, if asserted by the identity provider.'),
  email: z.email().optional().describe('Email address, if asserted by the identity provider.'),
});

/**
 * A first-class identity: the acting party behind every agent action.
 * OASP models identity as a claims contract — what must be asserted
 * (identity, scope memberships, roles) — rather than prescribing an
 * IdP, so any OIDC-mappable identity provider can back it.
 *
 * Existing purely to be referenced is not enough on its own: identity
 * only becomes load-bearing through the on-behalf-of model, where
 * every agent action carries `{ principal, on_behalf_of?, scope }` —
 * an assistant acts *as* a member for attribution while remaining
 * scope-pinned. See {@link principalRefSchema} in `common/` for the
 * lightweight pointer shape used at those call sites.
 *
 * @see docs/oasp-v0-concept.md § Principal (identity plane — federation-shaped)
 */
export const principalSchema = z
  .object({
    resourceType: resourceType('Principal'),
    id: z.string().min(1).describe('Unique identifier of this Principal.'),
    kind: principalKindSchema.describe('The kind of acting party: a human user, a service, or an agent.'),
    identity: principalIdentitySchema.describe('The IdP-agnostic, OIDC-mappable claims-contract identity assertion.'),
    scopeMemberships: z
      .array(scopeSchema)
      .describe('The scopes this principal is a member of, used to resolve most-specific-scope-wins.'),
    roles: z
      .array(z.string().min(1))
      .describe('IdP-agnostic role names asserted for this principal, independent of scope membership.'),
  })
  .describe('A first-class identity: the acting party behind every agent action.')
  .meta({ id: 'Principal' });

/** Inferred Principal shape. Always derive from `principalSchema` — never hand-write. */
export type Principal = z.infer<typeof principalSchema>;
