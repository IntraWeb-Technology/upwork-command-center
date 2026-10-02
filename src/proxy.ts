import { clerkMiddleware } from '@clerk/nextjs/server';

// clerkMiddleware() only attaches the auth context to every request.
// Authorization lives at each boundary: the /dashboard layout (`auth.protect()`
// plus the owner check) and every API route handler (`withOwner`). The n8n callback
// route is the exception: it authenticates with its own bearer and per-run tokens.
export default clerkMiddleware();
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    '/__clerk/:path*'
  ]
};
