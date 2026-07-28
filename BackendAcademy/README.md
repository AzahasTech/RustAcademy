# BackendAcademy

RustAcademy backend module — placeholder for future NestJS backend implementation.

## Getting Started

```bash
pnpm install
pnpm run dev
```

## Structure

- `src/` — Application source code (NestJS modules, controllers, services)
- `test/` — Test files

## Validation

Environment variables are validated at startup using `src/config/env.schema.ts`. The package requires the environment shape to match the schema and rejects unknown keys.

See `app/backend/` for the primary backend implementation and conventions.

