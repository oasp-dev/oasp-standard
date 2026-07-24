import type { Scope, Session } from '@oasp/schemas';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';

/**
 * Input to {@link import('./create-conversation').createConversationSetup}.
 *
 * **Issue #7 Tranche A:** `initiatingPrincipal` (a bare caller-supplied
 * `PrincipalRef`) is deliberately removed, not merely deprecated — it
 * was the same trust-boundary gap `CallerContext` was elsewhere: a
 * caller could name any `{kind, id}` as the conversation's initiator,
 * and the pre-Tranche-A server trusted it outright. `actor` — a
 * server-minted `AuthenticatedActor` (see `auth/authenticate.ts`) —
 * replaces it as the ONLY identity source: `createConversationSetup`
 * derives both the emitted `AuditEvent.who` and the new `Conversation`'s
 * own `initiatingPrincipal` field from it, so there is no second,
 * independently-suppliable identity claim that could ever drift from
 * the authenticated one.
 */
export interface CreateConversationInput {
  readonly agentDefinitionId: string;
  readonly scope: Scope;
  readonly actor: AuthenticatedActor;
  readonly resources?: Session['resources'];
}
