import { z } from 'zod';

/**
 * The set of agent-hosting providers OASP resources may reference.
 *
 * `anthropic` is the reference adapter implemented by Loom. `openai`
 * (Responses API) and `google` are reserved by name per the v0 concept
 * draft's Adapter contract — a conformant server may accept them in
 * data even before it ships an adapter for them, so consumers should
 * not treat unknown-but-listed values as an error.
 *
 * Registered under a stable `id` so every resource that embeds a
 * provider reference reuses one `$defs` entry instead of redefining
 * the enum inline.
 *
 * @see docs/oasp-v0-concept.md § Adapter contract
 */
export const providerSchema = z
  .enum(['anthropic', 'openai', 'google'])
  .describe(
    'Agent-hosting provider. `anthropic` is the reference adapter; `openai` and `google` are reserved by name for future adapters.',
  )
  .meta({ id: 'Provider' });

/** Inferred provider identifier. Always derive from `providerSchema` — never hand-write. */
export type Provider = z.infer<typeof providerSchema>;
