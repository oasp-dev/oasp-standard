/**
 * A tiny, dependency-free, deterministic string hash (FNV-1a, 32-bit),
 * used to compute a `Deployment.canonicalHash` stand-in from an
 * `AgentDefinition`'s serialized content. Not cryptographic — the mock
 * provider only needs "same input always produces the same output,
 * different input usually produces a different output," which FNV-1a
 * satisfies more than adequately for deterministic test fixtures.
 */
export function computeCanonicalHash(canonicalContent: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonicalContent.length; i += 1) {
    hash ^= canonicalContent.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
