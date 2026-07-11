import { createHash } from 'node:crypto';

/**
 * Canonical digest of `send`'s posted message content, for
 * `AuditEvent.evidence.contentDigest` (issue #11, Tranche A) — see
 * `docs/spec/audit.md` § Action-specific evidence. Formatted
 * `sha256:<hex>` so the algorithm travels with the value rather than
 * being assumed out-of-band.
 *
 * This is a real cryptographic hash (unlike `computeCanonicalHash`'s
 * deliberately non-cryptographic FNV-1a mock stand-in for
 * `Deployment.canonicalHash`) — `send` content is caller-controlled
 * free text an auditor may need to verify was not tampered with after
 * the fact, which FNV-1a's collision resistance does not support.
 * `node:crypto` is a local, synchronous, deterministic computation —
 * consistent with this package's zero-network, zero-randomness charter
 * (`README.md`: "Deterministic. CI-runnable. ... Zero network.").
 *
 * Digests only the *message content* `send` is given, never an
 * `AgentDefinition` version's content — that hash is a distinct,
 * deferred concern (issue #18; see `audit-event.ts`'s `evidence`
 * schema doc comment).
 */
export function computeContentDigest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}
