# Clerk Setup Guide

Clerk provides authentication only. This application is single-user; Clerk Organizations and Clerk Billing are intentionally not used (see rule 8 in [AGENTS.md](../AGENTS.md)).

## Local setup

1. Install and sign in to the Clerk CLI:

   ```bash
   npm install -g clerk
   clerk auth login
   ```

2. Pull development keys for the linked Clerk application into `.env.local`:

   ```bash
   clerk env pull --app <app_id> --instance dev --file .env.local
   ```

3. Make sure `.env.local` also contains the auth routes used by this app:

   ```bash
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/sign-up
   NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard/overview
   NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard/overview
   ```

4. Verify with `clerk doctor`.

## Notes

- Avoid `clerk init` on this project. It scaffolds a second `ClerkProvider` in `src/app/layout.tsx` and duplicate `/sign-in` and `/sign-up` routes. The provider already lives in `src/components/layout/providers.tsx` and the auth pages live under `src/app/auth/`.
- Route protection happens in `src/app/dashboard/layout.tsx` via `auth.protect()`. `src/proxy.ts` only attaches the auth context.
- Users may not have an email address (for example, username-only sign-in), so do not assume `user.emailAddresses[0]` exists.
- `CLERK_SECRET_KEY` is server-only. Never expose it to client code.
