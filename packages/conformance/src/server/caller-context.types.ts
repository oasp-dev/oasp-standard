import type { PrincipalRef } from '@oasp/schemas';

/**
 * Who is invoking an interaction against the reference server: the
 * acting `Principal`, and — when the action is performed on behalf of
 * another party (e.g. an assistant acting as a member) — that party.
 * Mirrors the on-behalf-of model's `{ principal, on_behalf_of? }` shape
 * (`docs/spec/scope-and-identity.md` § On-behalf-of and scope-pinning).
 * Every one of the six audited interactions takes a `CallerContext` so
 * its emitted `AuditEvent.who` can be populated correctly.
 */
export interface CallerContext {
  readonly principal: PrincipalRef;
  readonly onBehalfOf?: PrincipalRef;
}
