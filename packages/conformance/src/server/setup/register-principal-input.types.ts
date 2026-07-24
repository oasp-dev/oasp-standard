import type { Principal, Scope } from '@oasp/schemas';

/** Input to {@link import('./register-principal').registerPrincipalSetup}. */
export interface RegisterPrincipalInput {
  readonly kind: Principal['kind'];
  readonly subject: string;
  readonly issuer?: string;
  readonly scopeMemberships: readonly Scope[];
  readonly roles: readonly string[];
}
