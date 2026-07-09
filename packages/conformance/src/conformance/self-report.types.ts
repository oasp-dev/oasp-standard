import type { ConformanceLevel } from './conformance-level.types';

/**
 * A declaration, from an implementation under test, of which
 * {@link ConformanceLevel}(s) it claims to meet. The conformance kit
 * never takes this at face value — see `verify-self-report.ts`, which
 * runs the corresponding check suite for every claimed level and
 * reports any claim that does not actually hold. A self-report is
 * input to verification, not proof of it.
 */
export interface ConformanceSelfReport {
  readonly levels: readonly ConformanceLevel[];
}
