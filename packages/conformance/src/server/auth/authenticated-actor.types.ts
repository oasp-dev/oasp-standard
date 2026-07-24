import type { PrincipalRef, Scope } from '@oasp/schemas';

/**
 * A `Principal` a caller has already authenticated as, minted by
 * {@link import('./authenticate').authenticate} from the server's own
 * stored `Principal` records — **never** assembled from request-body
 * input. This is the trust boundary Tranche A closes (issue #7): the
 * pre-Tranche-A `CallerContext` was a `{ principal: PrincipalRef,
 * onBehalfOf?: PrincipalRef }` the caller simply asserted, and the
 * reference server trusted it outright — any caller could claim to be
 * any `Principal` merely by naming its `{kind, id}` in the request
 * body. An `AuthenticatedActor` cannot be forged the same way: it only
 * ever comes from `authenticate()` resolving a `principalId` against
 * `ServerState.principals`, so its `scopeMemberships`/`roles` are
 * always the SERVER's record of the acting party, not the caller's own
 * claim about itself.
 *
 * Every one of the six write-path interactions (`publish`, `migrate`,
 * `drain`, `stream`, `send`, `sendToolResult`) and `createConversation`
 * now take an `AuthenticatedActor` in place of `CallerContext` — see
 * `authorize.ts` for how one is checked against a resource's `scope`.
 */
export interface AuthenticatedActor {
  /** The authenticated `Principal`'s id — the same id `ServerState.principals` stores it under. */
  readonly principalId: string;
  /** The stored `Principal.identity.subject` — an OIDC-mappable stable subject identifier, carried onto the actor unchanged from the record `authenticate()` resolved. */
  readonly subject: string;
  /** The stored `Principal.identity.issuer`, if the record carries one. */
  readonly issuer?: string;
  /** The stored `Principal.scopeMemberships` at authentication time — the set an un-delegated action is authorized against (see `authorize.ts`). */
  readonly scopeMemberships: readonly Scope[];
  /** The stored `Principal.roles` at authentication time. Not consulted by `authorize.ts` in this tranche — carried for a future authorization extension, per `docs/spec/scope-and-identity.md`'s `roles` note. */
  readonly roles: readonly string[];
  /** Present only when this actor authenticated to act on behalf of another `Principal` — see {@link VerifiedDelegation}. */
  readonly delegation?: VerifiedDelegation;
  /** Names how this actor was authenticated (e.g. `'reference'` for this package's in-memory seam). Never used for authorization decisions — informational only, for audit/debugging. */
  readonly authenticationMethod: string;
}

/**
 * A server-verified on-behalf-of delegation, per
 * `docs/spec/scope-and-identity.md` § On-behalf-of and scope-pinning:
 * the containment rule. `scopePin` is the authorization CEILING for
 * every interaction this actor performs while delegated — `authorize.ts`
 * checks a delegated actor's target scope against `scopePin` alone,
 * never against either party's `scopeMemberships`/`roles`, so neither
 * party's broader memberships can widen what the delegated action may
 * reach.
 *
 * **Deferred to a follow-up (delegation-issuance policy):** this
 * tranche verifies only that `onBehalfOf` names a genuinely registered
 * `Principal` — it does not yet check that the acting principal is
 * itself entitled to act on that party's behalf (e.g. an assistant/member
 * pairing grant). That richer issuance policy is intentionally out of
 * scope here; see `authenticate.ts`'s doc comment.
 */
export interface VerifiedDelegation {
  /** The `Principal` this actor is acting on behalf of, resolved server-side (never trusted from request input). */
  readonly onBehalfOf: PrincipalRef;
  /** The authorization ceiling for this delegation — see the containment rule above. */
  readonly scopePin: Scope;
}
