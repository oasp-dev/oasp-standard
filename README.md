# OASP — Open Agent Session Protocol

A vendor-neutral standard for agent conversations that outlive their
execution context — across providers, with first-class identity and
audit. See [`docs/oasp-v0-concept.md`](./docs/oasp-v0-concept.md) for
the v0 concept draft.

Loom is the reference server: *Loom implements OASP.* Home:
[oasp.dev](https://oasp.dev).

## Repo layout

This is a pnpm workspace.

```
packages/
  schemas/          @oasp/schemas — Zod-first v0 resource schemas (the source of truth),
                     plus the generator that produces JSON Schema and OpenAPI from them.
schemas/v1alpha1/    Generated JSON Schema, one file per resource. Do not hand-edit —
                     see packages/schemas/README.md.
openapi/             Generated OpenAPI 3.1 document. Do not hand-edit.
docs/                Spec prose, starting with the v0 concept draft.
```

## Getting started

```sh
pnpm install
pnpm generate    # regenerate schemas/ and openapi/ from packages/schemas/src
pnpm typecheck
pnpm test
```

## Schema resolution — `schema.oasp.dev`

Every generated resource schema declares an `$id` under
`https://schema.oasp.dev/v1alpha1/`. **Live resolution at that domain
awaits the DNS record** (Brett-gated) — the GitHub Pages publishing
workflow (`.github/workflows/pages.yml`) and `schemas/CNAME` are wired
up and ready, but the domain itself has not been pointed at Pages yet.
Until then, resolve schemas from a local checkout under
`schemas/v1alpha1/` instead; see `packages/schemas/README.md` for the
`$schema` directive convention.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE).
