import type { AuditEvent } from '@oasp/schemas';
import type { CallerContext } from '../caller-context.types';

/**
 * Builds an `AuditEvent.who` from a {@link CallerContext}. Exists
 * because `tsconfig.base.json` sets `exactOptionalPropertyTypes: true`
 * — `onBehalfOf` must be omitted entirely when absent, never present
 * with value `undefined` — so every call site needs the same
 * conditional-spread shape; centralising it here means that shape is
 * written once, not at every one of the six interactions.
 */
export function buildAuditWho(caller: CallerContext): AuditEvent['who'] {
  return caller.onBehalfOf ? { principal: caller.principal, onBehalfOf: caller.onBehalfOf } : { principal: caller.principal };
}
