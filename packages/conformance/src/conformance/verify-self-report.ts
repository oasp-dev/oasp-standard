import { failed } from './check-result.types';
import type { CheckResult } from './check-result.types';
import type { ConformanceLevel } from './conformance-level.types';
import type { ConformanceSelfReport } from './self-report.types';
import type { ConformanceCheckRunners, ConformanceVerificationResult } from './verify-self-report.types';

/**
 * Verifies a {@link ConformanceSelfReport} against the check suites
 * supplied in `runners` — the mechanism `docs/spec/adapters.md` and
 * `docs/spec/README.md` § Conformance levels point to: a server
 * declares which level(s) it meets, and this function runs the actual
 * checks rather than trusting the declaration.
 *
 * A claimed level with no corresponding entry in `runners` is treated
 * as an **unverifiable claim** and reported as failing — a caller
 * cannot verify what it has no check for, and silently passing an
 * unverifiable claim would defeat the entire point of this function.
 */
export async function verifySelfReport(
  selfReport: ConformanceSelfReport,
  runners: ConformanceCheckRunners,
): Promise<ConformanceVerificationResult> {
  const results: Partial<Record<ConformanceLevel, readonly CheckResult[]>> = {};

  for (const level of selfReport.levels) {
    const runner = runners[level];
    results[level] = runner
      ? await runner()
      : [failed(`self-report: claimed level "${level}"`, 'no check runner was supplied for this claimed level — an unverifiable claim')];
  }

  const allClaimsVerified = selfReport.levels.every((level) => (results[level] ?? []).every((result) => result.passed));

  return { claimedLevels: selfReport.levels, results, allClaimsVerified };
}
