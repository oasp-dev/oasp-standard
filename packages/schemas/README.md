# @oasp/schemas

Zod-first resource schemas for OASP v0. **The Zod schemas under
`src/resources/` and `src/common/` are the single source of truth.**
JSON Schema (`schemas/v1alpha1/*.json`, at the repo root) and OpenAPI
(`openapi/oasp-v1alpha1.yaml`, at the repo root) are *generated* from
them — never hand-edited.

## Generating artifacts

```sh
pnpm --filter @oasp/schemas generate
# or, from the repo root:
pnpm generate
```

This regenerates every file under `schemas/v1alpha1/` and
`openapi/oasp-v1alpha1.yaml`. Regeneration is deterministic — running
it twice in a row produces byte-identical output — and CI enforces
that the committed artifacts match what `generate` produces right now
(the "drift gate": see `src/generate/generate.test.ts` and
`.github/workflows/ci.yml`). If you change a resource schema, run
`generate` and commit the resulting diff alongside it.

## The `$schema` directive convention

Every generated resource file is a self-contained JSON Schema document
published at:

```
https://schema.oasp.dev/v1alpha1/<Resource>.json
```

(e.g. `https://schema.oasp.dev/v1alpha1/AgentDefinition.json`). To get
editor completion and validation when hand-authoring an OASP resource
as a standalone JSON (or YAML, in editors that support it) file, point
it at that URL with a `$schema` directive as the first key:

```json
{
  "$schema": "https://schema.oasp.dev/v1alpha1/AgentDefinition.json",
  "id": "agentdef_01hz3x9k2v",
  "name": "Support Assistant",
  "...": "..."
}
```

Most editors (VS Code's built-in JSON language service, JetBrains
IDEs, `ajv-cli`, etc.) resolve `$schema` automatically once it points
at a reachable URL and will validate the document and offer
autocomplete for every field — including the `.describe()` text on
each field, which flows through into the generated schema's
`description` keywords. Until the `schema.oasp.dev` DNS record exists
(Brett-gated — see the root `README.md`), point your editor at the
matching file under `schemas/v1alpha1/` in a local checkout instead;
the document shape and `$id` are identical either way.

## A note on `format` assertion (URL fields)

In JSON Schema draft 2020-12, `format` (e.g. `"format": "uri"` on
`AgentDefinition` `serverUrl` and `Credential` `mcpServerUrl`) is an
*annotation* by default — a generic validator will **not** reject a
malformed URL unless it opts into the format-assertion vocabulary. The
Zod source enforces these formats at parse time, so validating through
`@oasp/schemas` is strict; validating a document directly against the
published JSON Schema is only as strict as your validator's format
handling. If you rely on the JSON Schema alone, enable format assertion
(e.g. `ajv-formats` with `{ mode: 'full' }`, or `ajv --spec=draft2020
--strict=true` with formats) so URL fields are actually checked. Fields
with an accompanying regex `pattern` (email, date-time) are enforced
regardless.

## Layout

```
src/
  common/       Shared sub-schemas (Scope, Provider, PrincipalRef, …), reused across resources.
  resources/    One file per v0 resource — the eight schemas this package exists to define.
  generate/     Pure functions that turn the schemas above into JSON Schema / OpenAPI,
                plus the thin CLI/fs-writing wrapper around them.
fixtures/
  valid/        One realistic example per resource. Round-tripped through its schema in fixtures.test.ts.
  invalid/      One invalid example per resource, each paired with a `*.expected.json`
                describing the zod issue(s) it must fail with.
```

## Adding a resource or shared sub-schema

1. Add the Zod schema under `src/resources/` (or `src/common/` if it's
   shared). Register it with `.meta({ id: 'YourName' })` — that id
   becomes its JSON Schema filename/`$id` and its OpenAPI
   `components.schemas` key.
2. Export it from `src/resources/index.ts` (or `src/common/index.ts`).
3. Add it to `RESOURCE_SCHEMAS` in `src/generate/resource-registry.ts`
   if it's a top-level resource (shared sub-schemas don't need this —
   they're picked up automatically via `$defs` extraction wherever a
   resource references them).
4. Add a valid + invalid fixture under `fixtures/`.
5. Run `pnpm generate` and commit the resulting artifacts.
