# Upwork Command Center

Personal control center for the Upwork Job Hunter Automation system.

This is a single-user internal application. It is the UI/control plane for the automation system; n8n remains the workflow engine. See [AGENTS.md](./AGENTS.md) for project rules.

The application is currently a trimmed starter baseline. The remaining Product and Users pages are reference implementations of the table, form, and data-layer patterns and will be replaced by Upwork-specific features.

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
| Product List (Table) | Reference pattern: TanStack Table, React Query (server prefetch, client cache), nuqs URL state. Mock data.       |
| Product Form         | Reference pattern: TanStack Form and Zod with `useMutation` and cache invalidation. Mock data.                   |
| Users (Table)        | Reference pattern: same setup as Products. Mock data.                                                            |
| Profile              | Clerk's account management UI.                                                                                   |

## Folder Structure

```plaintext
src/
├── app/                           # Next.js App Router directory
│   ├── auth/                      # Auth pages (sign-in, sign-up)
│   ├── dashboard/                 # Dashboard route group
│   │   ├── overview/              # Analytics with parallel routes
│   │   ├── product/               # Product CRUD pages (reference pattern)
│   │   ├── users/                 # Users table (reference pattern)
│   │   └── profile/               # User profile (Clerk)
│   └── api/                       # Route handlers (mock products/users API)
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
│   ├── products/                  # Product listing, form, tables
│   ├── users/                     # User table
│   ├── auth/                      # Auth components
│   └── profile/                   # Profile components
│
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

> [!NOTE]
> On Windows, keep LF line endings (`git config core.autocrlf false`) or `bun run format:check` will flag every file.

### Environment variables

See `env.example.txt`. Never commit `.env*` files or real keys, user IDs, URLs, or tokens; use placeholders in examples.

- **Required:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `OWNER_CLERK_USER_ID`.
- **Optional:** Sentry (inactive without `NEXT_PUBLIC_SENTRY_DSN`) and build settings.
- **Not used yet:** database and n8n variables; they are validated only if set.

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
| `bun run test`         | Unit and integration tests (Vitest, single run) |
| `bun run test:watch`   | Vitest in watch mode          |
| `bun run test:contracts` | n8n contract tests and fixture validation |
| `bun run contracts:generate` | Regenerate `contracts/json-schema` from the Zod contracts |
| `bun run contracts:check` | Fail if the committed JSON Schema is stale |
| `bun run test:e2e`     | Playwright smoke tests against the production build (run `bun run build` first; first time: `bunx playwright install chromium`) |

Tests live next to the code as `*.test.ts(x)`; component tests opt into jsdom with `// @vitest-environment jsdom`. Playwright specs live in `e2e/`.

### CI

`.github/workflows/ci.yml` runs on pushes to `development` and `main` and on pull requests targeting them: frozen install, format check, strict lint, typecheck, tests, production build, and Playwright smoke tests (Node 24, Bun). It needs a Clerk development instance configured in the repository settings: the variable `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and the secret `CLERK_SECRET_KEY`.

CI also fails when the generated contract JSON Schema is stale (`bun run contracts:check`); see [docs/contracts.md](./docs/contracts.md).

GitHub currently annotates runs with "Node.js 20 is deprecated" for `actions/checkout@v4` and `actions/setup-node@v4`. The runner already executes them on Node 24 and the jobs pass, so this is informational; upgrading those actions is a separate maintenance task.

Git hooks: pre-commit formats staged files; pre-push runs a production build.

## Further documentation

- [docs/contracts.md](./docs/contracts.md) - versioned n8n integration contracts
- [docs/forms.md](./docs/forms.md) - form system (TanStack Form + Zod)
- [docs/themes.md](./docs/themes.md) - theme system
- [docs/deployment.md](./docs/deployment.md) - Vercel and Docker deployment
