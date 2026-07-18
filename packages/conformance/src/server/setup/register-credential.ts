import { credentialSchema, type Credential } from '@oasp/schemas';
import type { ServerState } from '../store/server-state';
import type { RegisterCredentialInput } from './register-credential-input.types';

/**
 * Setup helper: registers a `Credential` available for later
 * `vaultIds` resolution (see `../credential/resolve-vault-ids.ts`).
 * Not an audited interaction itself — v0's seven audited interactions
 * are `publish`, `createConversation`, `migrate`, `drain`, `stream`,
 * `send`, `sendToolResult`, and credential *registration* is not one of
 * them. Its later *resolution* into a Session's `vaultIds` is audited,
 * by name, on both `createConversation` and `migrate` — see
 * `docs/spec/audit.md` § Credential attachment is audited
 * (`createConversation` and `migrate`).
 */
export function registerCredentialSetup(state: ServerState, input: RegisterCredentialInput): Credential {
  state.counters.credential += 1;
  const id = `credential_${state.counters.credential}`;

  const credential = credentialSchema.parse({
    resourceType: 'Credential',
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
