import type { AuditEvent } from '@oasp/schemas';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';
import type { ServerState } from '../store/server-state';

/**
 * Builds an `AuditEvent.who` from an {@link AuthenticatedActor} — the
 * single call site every one of the seven audited interactions now
 * shares (issue #7 Tranche A unified `createConversation`'s previously
 * separate `who`-construction into this same helper, since it too now
 * takes an `AuthenticatedActor`). `who.principal` is a `PrincipalRef`
 * built from the actor's `principalId` plus the stored `Principal`'s
 * `kind` (`AuthenticatedActor` itself carries no `kind` — only
 * `authenticate()`'s source-of-truth lookup does), looked up here via
 * `state.principals` rather than trusted from anywhere else.
 * `who.onBehalfOf` comes ONLY from `actor.delegation.onBehalfOf` — never
 * from request input — per the containment rule
 * (`docs/spec/scope-and-identity.md`).
 *
 * Exists (rather than inlining this at each call site) because
 * `tsconfig.base.json` sets `exactOptionalPropertyTypes: true` —
 * `onBehalfOf` must be omitted entirely when absent, never present with
 * value `undefined` — so every call site needs the same
 * conditional-spread shape.
 */
export function buildAuditWho(state: ServerState, actor: AuthenticatedActor): AuditEvent['who'] {
  const principal = state.principals.get(actor.principalId);
  if (!principal) {
    throw new Error(`Invariant violated: AuthenticatedActor names principalId "${actor.principalId}", which has no registered Principal record.`);
  }

  const principalRef = { kind: principal.kind, id: actor.principalId };
  return actor.delegation ? { principal: principalRef, onBehalfOf: actor.delegation.onBehalfOf } : { principal: principalRef };
}
