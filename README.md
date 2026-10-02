# Upwork Command Center

Personal control center for the Upwork Job Hunter Automation system.

This is a single-user internal application. It is the UI/control plane for the automation system; n8n remains the workflow engine. See [AGENTS.md](./AGENTS.md) for project rules.

The first Upwork feature is manual job analysis: paste a listing, save an immutable snapshot, and get a scored analysis from the `ujh.analyze.v1` workflow (see [docs/manual-job-analysis.md](./docs/manual-job-analysis.md)). The Overview and Users pages are remaining starter references with mock data.

## Upstream

Original project: https://github.com/Kiranism/next-shadcn-dashboard-starter

This repository originated from that project (MIT License, see [LICENSE](./LICENSE)) and has since been adapted for the Upwork Command Center. The `upstream` git remote points at the original repository so future upstream fixes can be inspected and selectively incorporated:

```bash
git fetch upstream
git log --oneline development..upstream/main
```

## Tech Stack

- Framework - [Next.js 16](https://nextjs.org) (App Router) with React 19
- Language - [TypeScript](https://www.typescriptlang.org) (strict)
- Auth - [Clerk](https://clerk.com)
- Error tracking - [Sentry](https://sentry.io) (optional, disabled without a DSN)
- Styling - [Tailwind CSS v4](https://tailwindcss.com)
- Components - [shadcn/ui](https://ui.shadcn.com) on [Base UI](https://base-ui.com) primitives
- Charts - [Recharts](https://recharts.org)
- Schema validation - [Zod](https://zod.dev)
- Data fetching - [TanStack React Query](https://tanstack.com/query)
- Search param state - [Nuqs](https://nuqs.47ng.com/)
- Tables - [TanStack Table](https://tanstack.com/table)
- Forms - [TanStack Form](https://tanstack.com/form) + Zod
- Command+K interface - [kbar](https://kbar.vercel.app/)
- Linter / Formatter - [OxLint](https://oxc.rs/docs/guide/usage/linter) / [Oxfmt](https://oxc.rs/docs/guide/usage/formatter)
- Git hooks - [Husky](https://typicode.github.io/husky/) (pre-commit formats staged files, pre-push runs a production build)
- Package manager - [Bun](https://bun.sh)

## Pages

| Page                 | Notes                                                                                                            |
| :------------------- | :--------------------------------------------------------------------------------------------------------------- |
| Sign in / Sign up    | Clerk, at `/auth/sign-in` and `/auth/sign-up`.                                                                   |
| Dashboard Overview   | Cards and Recharts graphs. Parallel routes give each section its own loading and error state. Mock data.         |
| Jobs                 | Saved jobs with stage, system score, and disposition. TanStack Table, React Query, nuqs URL state. PostgreSQL.   |
| Analyze Job          | Paste a listing (title, optional Upwork URL, full text) and start the analysis.                                   |
| Job detail           | Listing snapshot, analysis (score, dimensions, signals), timeline, override, and decline.                        |
| Users (Table)        | Starter reference pattern. Mock data.                                                                            |
| Profile              | Clerk's account management UI.                                                                                   |

## Folder Structure

```plaintext
src/
├── app/                           # Next.js App Router directory
│   ├── auth/                      # Auth pages (sign-in, sign-up)
│   ├── dashboard/                 # Dashboard route group
│   │   ├── overview/              # Analytics with parallel routes
│   │   ├── jobs/                  # Jobs list, Analyze Job form, job detail
│   │   ├── users/                 # Users table (reference pattern)
│   │   └── profile/               # User profile (Clerk)
│   └── api/                       # Route handlers (jobs, workflow runs, n8n callback, mock users)
│
├── components/                    # Shared components
│   ├── ui/                        # UI primitives (buttons, inputs, dialogs, etc.)
│   ├── layout/                    # Layout components (header, sidebar, etc.)
│   ├── forms/                     # Shared TanStack Form field components
│   ├── themes/                    # Theme system (selector, mode toggle, config)
│   └── kbar/                      # Command+K interface
│
├── features/                      # Feature-based modules
│   ├── overview/                  # Dashboard analytics (charts, cards)
│   ├── jobs/                      # Jobs UI and client data layer
│   ├── users/                     # User table
│   ├── auth/                      # Auth components
│   └── profile/                   # Profile components
│
├── server/                        # Server-only code: database, runs, jobs, analyses, n8n
├── lib/                           # Core utilities (query-client, searchparams, etc.)
├── hooks/                         # Custom hooks
├── config/                        # Navigation, infobar, data table config
├── constants/                     # Mock data
├── styles/                        # Global CSS & theme files
└── types/                         # TypeScript types
```

## Getting Started

Clone the repo:

```bash
git clone https://github.com/IntraWeb-Technology/upwork-command-center.git
```

- Install **Node 24** (`.nvmrc`; `package.json` `engines` allows 24.x only). Node is the application runtime in development and production.
- Install [Bun](https://bun.sh) 1.4 (package manager and script runner only; `bun.lock` is the lockfile)
- `bun install --frozen-lockfile`
- Copy the example env file: `cp env.example.txt .env.local`
- Fill in the required variables in `.env.local`. Clerk keys are required for the dashboard to load (`clerk env pull` with the Clerk CLI writes them for you). Set `OWNER_CLERK_USER_ID` to your own Clerk user ID. Sentry is optional.
- `bun run dev`

The app runs at http://localhost:3000 (or the next free port).

### Local database and fake n8n

Jobs need PostgreSQL. Requires Docker. The compose database uses synthetic, local-only credentials on `127.0.0.1:54329`:

```bash
docker compose up -d --wait   # Postgres 17 with ucc_dev and ucc_test databases
# In .env.local: DATABASE_URL=postgres://ucc:ucc_local_only@127.0.0.1:54329/ucc_dev
bun run db:migrate            # apply committed migrations to ucc_dev
bun run test:integration      # integration tests (each run uses its own temporary database)
```

To analyze jobs without n8n, add `N8N_MODE=fake` to `.env.local`: an in-process fake answers with fixture results through the real callback path. Without it, starting an analysis needs the real n8n configuration and otherwise returns "Analysis is not available".

See [docs/persistence.md](./docs/persistence.md) and [docs/manual-job-analysis.md](./docs/manual-job-analysis.md).

> [!NOTE]
> On Windows, keep LF line endings (`git config core.autocrlf false`) or `bun run format:check` will flag every file.

### Environment variables

See `env.example.txt`. Never commit `.env*` files or real keys, user IDs, URLs, or tokens; use placeholders in examples.

- **Required:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `OWNER_CLERK_USER_ID`.
- **Optional:** Sentry (inactive without `NEXT_PUBLIC_SENTRY_DSN`) and build settings.
- **Feature-scoped:** `DATABASE_URL` (and optional `DATABASE_URL_DIRECT` for migrations), `APP_BASE_URL`, `N8N_MODE`, `N8N_BASE_URL`, `N8N_WEBHOOK_TOKEN`, `N8N_CALLBACK_TOKEN`, and the fake-transport settings `N8N_FAKE_SCENARIO`, `N8N_FAKE_DELAY_MS`, `N8N_ALLOW_FAKE_IN_PRODUCTION`. They are validated only if set; sign-in and the dashboard work without them, and code that needs one fails with its name. The n8n callback route answers `401` while `N8N_CALLBACK_TOKEN` is unset.

Server variables are validated at startup by `src/server/env.ts`. A missing or invalid value stops the server with the variable names (never the values).

### Single-owner access

Clerk authenticates; only the account whose user ID equals `OWNER_CLERK_USER_ID` is authorized. Other signed-in accounts see "Access denied" in the dashboard and get `403` from APIs; signed-out API requests get `401`. Every API route handler must be wrapped with `withOwner` from `src/server/auth/require-owner.ts`. Also restrict sign-ups in the Clerk dashboard.

### Clerk setup

See [docs/clerk_setup.md](./docs/clerk_setup.md). The sign-in and sign-up URLs must point at `/auth/sign-in` and `/auth/sign-up`.

### Scripts

| Command                | Purpose                       |
| :--------------------- | :---------------------------- |
| `bun run dev`          | Start the development server  |
| `bun run build`        | Production build              |
| `bun run start`        | Serve the production build    |
| `bun run typecheck`    | TypeScript check              |
| `bun run lint`         | OxLint                        |
| `bun run format:check` | Oxfmt check                   |
| `bun run test`         | Unit tests (Vitest, single run, no database) |
| `bun run test:watch`   | Vitest in watch mode          |
| `bun run test:integration` | PostgreSQL integration tests (`*.integration.test.ts`; needs the compose database or `TEST_DATABASE_URL` ending in `_test`) |
| `bun run db:generate --name <change>` | Generate a SQL migration from `src/server/db/schema.ts` |
| `bun run db:migrate`   | Apply committed migrations (`DATABASE_URL_DIRECT`, else `DATABASE_URL`) |
| `bun run db:check`     | Fail if the schema has changes without a migration |
| `bun run test:contracts` | n8n contract tests and fixture validation |
| `bun run contracts:generate` | Regenerate `contracts/json-schema` from the Zod contracts |
| `bun run contracts:check` | Fail if the committed JSON Schema is stale |
| `bun run test:e2e`     | Playwright tests against the production build with the fake n8n transport (run `bun run build` first; first time: `bunx playwright install chromium`). The signed-in job analysis flow also needs `DATABASE_URL` and `E2E_CLERK_USER_ID` (a dedicated Clerk test user) and is skipped otherwise. |

Tests live next to the code as `*.test.ts(x)`; component tests opt into jsdom with `// @vitest-environment jsdom`. Playwright specs live in `e2e/`.

### CI

`.github/workflows/ci.yml` runs on pushes to `development` and `main` and on pull requests targeting them: frozen install, format check, strict lint, typecheck, tests, production build, and Playwright smoke tests (Node 24, Bun). It needs a Clerk development instance configured in the repository settings: the variable `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and the secret `CLERK_SECRET_KEY`.

CI also fails when the generated contract JSON Schema is stale (`bun run contracts:check`); see [docs/contracts.md](./docs/contracts.md).

A disposable PostgreSQL 17 service (synthetic credentials, no secrets) backs `db:check` (schema changed without a migration), `db:migrate` against the empty database, `test:integration`, and the Playwright server. The signed-in Playwright flow runs only when the repository variable `E2E_CLERK_USER_ID` names a dedicated Clerk test user.

GitHub currently annotates runs with "Node.js 20 is deprecated" for `actions/checkout@v4` and `actions/setup-node@v4`. The runner already executes them on Node 24 and the jobs pass, so this is informational; upgrading those actions is a separate maintenance task.

Git hooks: pre-commit formats staged files; pre-push runs a production build.

## Further documentation

- [docs/contracts.md](./docs/contracts.md) - versioned n8n integration contracts
- [docs/manual-job-analysis.md](./docs/manual-job-analysis.md) - manual job and analysis flow, tables, transport selection
- [docs/persistence.md](./docs/persistence.md) - PostgreSQL, migrations, workflow runs, callback security
- [docs/forms.md](./docs/forms.md) - form system (TanStack Form + Zod)
- [docs/themes.md](./docs/themes.md) - theme system
- [docs/deployment.md](./docs/deployment.md) - Vercel and Docker deployment
