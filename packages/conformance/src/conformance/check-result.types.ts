/** The outcome of one conformance check: a stable `name` for reporting, whether it `passed`, and an optional `detail` explaining a failure. */
export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

/** Builds a passing {@link CheckResult}. */
export function passed(name: string): CheckResult {
  return { name, passed: true };
}

/** Builds a failing {@link CheckResult}, with a detail message explaining what went wrong. */
export function failed(name: string, detail: string): CheckResult {
  return { name, passed: false, detail };
}
