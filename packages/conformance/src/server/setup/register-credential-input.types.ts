import type { Credential, PrincipalRef, Scope } from '@oasp/schemas';

/** Input to {@link import('./register-credential').registerCredentialSetup}. */
export interface RegisterCredentialInput {
  readonly provider: Credential['provider'];
  readonly vaultId: string;
  readonly mcpServerUrl: string;
  readonly scope: Scope;
  readonly onBehalfOf?: PrincipalRef;
}
