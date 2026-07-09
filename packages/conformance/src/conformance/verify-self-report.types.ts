import type { CheckResult } from './check-result.types';
import type { ConformanceLevel } from './conformance-level.types';

/** One check-suite runner per {@link ConformanceLevel} a caller is prepared to verify. A level absent here that the target still claims is reported as an unverifiable (failing) claim — see `verify-self-report.ts`. */
export interface ConformanceCheckRunners {
  readonly server?: () => Promise<readonly CheckResult[]>;
  readonly adapter?: () => Promise<readonly CheckResult[]>;
  readonly client?: () => Promise<readonly CheckResult[]>;
}

/** The outcome of verifying a {@link import('./self-report.types').ConformanceSelfReport} against its corresponding check suites. */
export interface ConformanceVerificationResult {
  readonly claimedLevels: readonly ConformanceLevel[];
  readonly results: Readonly<Partial<Record<ConformanceLevel, readonly CheckResult[]>>>;
  /** `true` only if every claimed level had a runner supplied AND every one of that runner's checks passed. A claimed level with no runner is treated as an unverifiable, and therefore failing, claim. */
  readonly allClaimsVerified: boolean;
}
