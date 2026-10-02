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

- Install [Bun](https://bun.sh) (the project's package manager; `bun.lock` is the lockfile)
- `bun install --frozen-lockfile`
- Copy the example env file: `cp env.example.txt .env.local`
- Fill in the required variables in `.env.local`. Clerk keys are required for the dashboard to load (`clerk env pull` with the Clerk CLI writes them for you). Sentry is optional.
- `bun run dev`

The app runs at http://localhost:3000 (or the next free port).

> [!NOTE]
> On Windows, keep LF line endings (`git config core.autocrlf false`) or `bun run format:check` will flag every file.

### Environment variables

See `env.example.txt`. Clerk keys are required; Sentry and build settings are optional. Never commit `.env*` files.

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

## Further documentation

- [docs/forms.md](./docs/forms.md) - form system (TanStack Form + Zod)
- [docs/themes.md](./docs/themes.md) - theme system
- [docs/deployment.md](./docs/deployment.md) - Vercel and Docker deployment
