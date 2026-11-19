# TestTix — notes for Claude Code

TestTix is a sample event ticket shop (concerts, talks, meetups; seated and general-admission tickets) built as a realistic target for software testing practice. The app must be **correct and testable**: v1 ships with no intentional bugs.

## Source-of-truth docs

- `docs/development-plan.md` — milestones and chunks (C0.1 … C6.5), definition of done, resolved questions. **Work from this plan.**
- `docs/tech-stack-decisions.md` — architecture and tooling decisions. Don't change a **[Decided]** item without asking; **[Proposed]** items may be adjusted, but record the change in that doc in the same PR.
- `docs/idea.md` — product idea and the failure modes each feature exists to demonstrate.

When a decision changes, update the docs in the same PR so they stay accurate.

## Current status

- ✅ C0.1 Monorepo scaffold (initial commit on `main`)
- ✅ C0.2 CI skeleton
- ✅ C0.3 Local infra
- ✅ C0.4 API skeleton
- ⏭️ Next: **C0.5 Prisma + integration harness**, C0.6 web skeleton, then C0.7 (see plan)

Update this list when a chunk is merged.

## Workflow

- One chunk = one branch = one PR into `main`. Branch names: `c0-2-ci-skeleton`, `c3-1-seat-holds-api`.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`), with the chunk ID in the subject or body. Changelogs are generated from these later (release-please).
- Before opening a PR, run `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm format:check`.
- The PR description lists verification steps and their results (commands, curl calls, URLs).
- Follow the plan's **Definition of done** for every chunk.

## Commands

Requires Node 24 (`.nvmrc`, `engine-strict=true`) and pnpm via Corepack (`packageManager` in `package.json`).

```sh
pnpm install
pnpm build          # turbo, cached
pnpm typecheck
pnpm lint
pnpm test
pnpm format         # / format:check
```

Run one package: `pnpm --filter @testtix/api <script>`.

## Conventions and gotchas

- **TypeScript is pinned to 6.0.x.** typescript-eslint doesn't support TS 7 yet; don't bump until it does.
- TS 6 defaults `types` to `[]`. Node packages extend `@testtix/config/tsconfig/node.json` (which sets `types: ["node"]`); add other ambient types (e.g. `vitest/globals`) explicitly.
- ESM everywhere (`"type": "module"`, `NodeNext` resolution for Node packages, `Bundler` for `apps/web`). Relative imports in Node packages need `.js` extensions. ESM was kept for NestJS in C0.4 (see tech-stack §3).
- ESLint uses `typescript-eslint` `strictTypeChecked` + Prettier; shared config lives in `packages/config/eslint.js`.
- **NestJS is pinned to 11.x** because `nestjs-zod` doesn't support 12 yet; don't bump until it does.
- Nest DI relies on decorator metadata: `apps/api` sets `experimentalDecorators` + `emitDecoratorMetadata`, and Vitest transforms with `unplugin-swc`. Inject interfaces/types with `@Inject(TOKEN)` and `import type`; classes can be injected by type.
- API tests that don't need real infra use `createTestApp()` (`apps/api/src/testing/test-app.ts`): the real modules and `configureApp()`, with Postgres and Redis faked. Keep app-level setup in `configureApp()` so `main.ts` and tests share it.
- Every API error goes through `ProblemDetailsFilter` (problem+json). Throw Nest `HttpException`s or let Zod DTOs fail; don't hand-roll error bodies.
- New API env vars go in `apps/api/src/config/config.schema.ts` and `.env.example`.
- Root `package.json` `pnpm.ignoredBuiltDependencies` skips install scripts on purpose: `@scarf/scarf` is telemetry, `@swc/core`'s only re-checks its binary.
- Money is stored as integer cents, currency USD, locale `en-US` (`packages/shared`).
- `packages/shared` is compiled to `dist/`; turbo runs `^build` before dependants' typecheck, lint, test and dev.
- Pin exact dependency versions (no `^`), matching the existing `package.json` files.
- Server code must take "now" from `ClockService` (from C1.1), never `Date.now()` / `new Date()` directly.
- Prefer accessible names over `data-testid` in the UI; use `data-testid` only where no good accessible locator exists.
- Every list endpoint sorts with a stable tiebreaker (`id`).
- Local infra is `docker/compose.yml`, driven by `pnpm infra:*` from the repo root (`--project-directory .`, so the root `.env` overrides the compose defaults). Pin image tags to an exact version. New services get a health check, and `docker/smoke-test.sh` checks them.

## Repo

https://github.com/azeljkovic/testtix — public, MIT. Tests coupled to the code (unit, component, API integration) live here; UI/API e2e and k6 performance tests live in a separate repository.
