// Stub for Next.js' `server-only` marker. In a Next build the package
// is resolved to a module that throws when imported into a client
// bundle (so a misrouted `import "server-only"` fails the build instead
// of leaking server code to the browser). Vitest has no such bundler
// awareness; an alias to this empty module lets node-env tests import
// files like `lib/stations.server.ts` and `app/sitemap.ts` without the
// resolver crashing on a package that doesn't exist on disk.
export {};
