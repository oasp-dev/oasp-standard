/** Result of a successful `drain`: the session's confirmed status — always, and only, `'idle'` (see `run-drain-to-idle.ts`; anything else is a failure, never this type) — and which pending tool uses were resolved, oldest-enumerated-first. */
export interface DrainOutcome {
  readonly status: 'idle';
  readonly resolvedToolUseIds: readonly string[];
}
