# BackendAcademy

RustAcademy backend module — NestJS backend implementation for the Rust programming academy.

## Getting Started

```bash
pnpm install
pnpm run dev
```

## Testing

### Unit tests

```bash
# Run all unit tests
pnpm test

# Run a specific test file
npx jest --testPathPattern='users/users.service'

# Watch mode for development
npx jest --watch
```

### Integration tests

End-to-end learner journey tests covering authentication, enrollment, grading, and rewards flows:

```bash
npx jest --testPathPattern='integration/learner-journey'
```

### Test configuration

- `clearMocks`, `resetMocks`, `restoreMocks` are enabled to prevent shared-state leakage between test suites.
- `resetModules` is enabled so each test file receives a fresh module registry, preventing flaky tests from module-level singletons (see [#451](https://github.com/BlockDash-Studios/RustAcademy/issues/451)).

## Structure

- `src/` — Application source code (NestJS modules, controllers, services)
- `src/integration/` — Integration / end-to-end journey tests
- `test/` — Additional test files

See `app/backend/` for the primary backend implementation and conventions.
