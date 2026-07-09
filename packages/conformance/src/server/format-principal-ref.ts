import type { PrincipalRef } from '@oasp/schemas';

/** Renders a `PrincipalRef` as a compact `kind:id` string, for adapter operations (e.g. `sendMessage`'s attribution parameter) that take a plain string rather than the structured `PrincipalRef`. */
export function formatPrincipalRef(ref: PrincipalRef): string {
  return `${ref.kind}:${ref.id}`;
}
