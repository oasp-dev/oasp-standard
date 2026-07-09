import { credentialSchema, type Credential } from '@oasp/schemas';
import type { ServerState } from '../store/server-state';
import type { RegisterCredentialInput } from './register-credential-input.types';

/**
 * Setup helper: registers a `Credential` available for later
 * `vaultIds` resolution (see `../credential/resolve-vault-ids.ts`).
 * Not an audited interaction — per `docs/spec/audit.md` § The
 * credential-attach gap, credential *registration* is not itself one
 * of v0's six interactions; only its resolution at session-creation
 * time is a (currently unaudited, documented-gap) event.
 */
export function registerCredentialSetup(state: ServerState, input: RegisterCredentialInput): Credential {
  state.counters.credential += 1;
  const id = `credential_${state.counters.credential}`;

  const credential = credentialSchema.parse({
    id,
    provider: input.provider,
    vaultId: input.vaultId,
    mcpServerUrl: input.mcpServerUrl,
    scope: input.scope,
    ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}),
  });
  state.credentials.set(id, credential);
  return credential;
}
