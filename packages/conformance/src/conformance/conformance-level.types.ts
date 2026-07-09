/**
 * The three OASP conformance levels, per `docs/oasp-v0-concept.md` §
 * Conformance and `docs/spec/README.md` § Conformance levels:
 *
 * - `client` — consumes the API + Event vocabulary correctly.
 * - `server` — implements resources + interactions.
 * - `adapter` — maps a provider preserving required semantics.
 *
 * A single implementation can claim more than one — e.g. the reference
 * server in this package claims `server` (it implements the seven
 * interactions over an injected `AgentProvider`) but not `adapter` (it
 * does not itself map a real provider — that is the mock's job, tested
 * separately).
 */
export type ConformanceLevel = 'client' | 'server' | 'adapter';
