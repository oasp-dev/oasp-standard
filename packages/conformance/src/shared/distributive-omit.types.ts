/**
 * Like `Omit<T, K>`, but distributes over a union `T` instead of
 * collapsing it. Plain `Omit<T, K>` is defined as `Pick<T, Exclude<keyof
 * T, K>>`, and `keyof` a union type is the *intersection* of each
 * member's keys — so `Omit` on a discriminated union like `Event`
 * silently drops every variant-specific field (`messageId`, `toolUseId`,
 * `delta`, ...), leaving only fields common to every branch. This
 * conditional form (`T extends unknown ? ... : never`) forces
 * distribution: TypeScript applies `Omit<Member, K>` to each union
 * member individually, then unions the results back together, so the
 * variant-specific fields survive.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
