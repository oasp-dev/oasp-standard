import type { AuthenticateInput } from '../server/auth/authenticate-input.types';
import type { AuthenticatedActor } from '../server/auth/authenticated-actor.types';
import type { ReferenceServer } from '../server/reference-server.types';
import type { RegisterPrincipalInput } from '../server/setup/register-principal-input.types';
import { registerPrincipalInputFactory } from './register-principal-input-factory';

/**
 * Builds a genuinely server-minted `AuthenticatedActor` for test
 * scenarios: registers a fresh `Principal` on `server` (via
 * `registerPrincipalInputFactory`) and authenticates as it. Deliberately
 * NOT a pure value-object factory like `principalRefFactory`/`scopeFactory`
 * — an `AuthenticatedActor` is only ever meaningful in relation to a
 * `ServerState.principals` record (`buildAuditWho` looks one up by
 * `principalId`), so this factory takes the `server` it should be valid
 * against, rather than fabricating a detached object that would fail an
 * interaction's internal invariant check.
 *
 * `registerInput` overrides what `Principal` is registered (e.g. a
 * narrower/wider `scopeMemberships`); `delegation` — when supplied —
 * authenticates with an on-behalf-of pin, for exercising the
 * containment rule (see `auth/authorize.ts`).
 */
export function authenticatedActorFactory(
  server: ReferenceServer,
  options: { readonly registerInput?: Partial<RegisterPrincipalInput>; readonly delegation?: AuthenticateInput['delegation'] } = {},
): AuthenticatedActor {
  const principal = server.registerPrincipal(registerPrincipalInputFactory(options.registerInput));
  const authenticated = server.authenticate({ principalId: principal.id, ...(options.delegation ? { delegation: options.delegation } : {}) });
  if (!authenticated.ok) {
    throw new Error(`authenticatedActorFactory: authenticate() unexpectedly failed: ${authenticated.error.message}`);
  }
  return authenticated.value;
}
