/** @type {import('next').NextConfig} */
const nextConfig = {
  // Without this, Next walks up looking for a lockfile to infer the workspace
  // root and lands on ~/package-lock.json (an accidental home-dir install).
  // That pulls in the wrong tailwindcss from ~/node_modules and puts the
  // resolver into an infinite loop that pins RAM at multi-GB within seconds.
  turbopack: {
    root: import.meta.dirname,
  },
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
