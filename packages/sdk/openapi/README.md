# Medal Social OpenAPI Contract

`medal-social.openapi.yaml` is the source OpenAPI 3.1 contract for the public API surface covered by `@medalsocial/sdk`.

Published package artifacts:

- `@medalsocial/sdk/openapi.yaml` exposes this source YAML document.
- `@medalsocial/sdk/openapi.json` exposes the bundled JSON document generated during `pnpm build`.
- `@medalsocial/sdk/openapi-types` exposes TypeScript types generated from the contract.

Validation:

```bash
pnpm openapi:check
```
