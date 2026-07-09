import type { CallerContext } from '../server/caller-context.types';
import { principalRefFactory } from './principal-ref-factory';

/** Builds a `CallerContext` for test scenarios. Omit `onBehalfOf` unless a test specifically exercises delegated (on-behalf-of) attribution. */
export function callerContextFactory(overrides: Partial<CallerContext> = {}): CallerContext {
  return { principal: principalRefFactory(), ...overrides };
}
