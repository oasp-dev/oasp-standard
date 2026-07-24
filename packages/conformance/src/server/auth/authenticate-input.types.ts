import type { Scope } from '@oasp/schemas';

/** Input to {@link import('./authenticate').authenticate}. */
export interface AuthenticateInput {
  /** The id of a `Principal` already registered via `registerPrincipal` — resolved against `ServerState.principals`, never trusted as a bare claim. */
  readonly principalId: string;
  /** Present when this authentication is for a delegated (on-behalf-of) action — see `AuthenticatedActor.delegation`. */
  readonly delegation?: {
    /** The id of the `Principal` this actor is acting on behalf of — MUST also be a registered `Principal`, or authentication fails. */
    readonly onBehalfOfPrincipalId: string;
    /** The authorization ceiling for this delegation — see `docs/spec/scope-and-identity.md`'s containment rule. */
    readonly scopePin: Scope;
  };
}
