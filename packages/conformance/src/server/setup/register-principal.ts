import { principalSchema, type Principal } from '@oasp/schemas';
import type { ServerState } from '../store/server-state';
import type { RegisterPrincipalInput } from './register-principal-input.types';

/**
 * Setup helper: registers a full `Principal` resource in
 * `ServerState.principals` — the ONLY store `authenticate()` (issue #7
 * Tranche A) resolves a `principalId` against. Not an audited
 * interaction itself, same as `registerCredentialSetup`: v0's seven
 * audited interactions do not include Principal registration, only the
 * later authenticated use of one.
 *
 * Deliberately mirrors `registerCredentialSetup`'s shape: a
 * deterministic `principal_N` id via `state.counters.principal`,
 * schema-validated via `principalSchema.parse` before storage so a
 * malformed input fails loudly here rather than resolving to a broken
 * `AuthenticatedActor` later.
 */
export function registerPrincipalSetup(state: ServerState, input: RegisterPrincipalInput): Principal {
  state.counters.principal += 1;
  const id = `principal_${state.counters.principal}`;

  const principal = principalSchema.parse({
    resourceType: 'Principal',
    id,
    kind: input.kind,
    identity: { subject: input.subject, ...(input.issuer ? { issuer: input.issuer } : {}) },
    scopeMemberships: input.scopeMemberships,
    roles: input.roles,
  });
  state.principals.set(id, principal);
  return principal;
}
