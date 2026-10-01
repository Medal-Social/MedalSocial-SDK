/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace root holds the lockfile; tell Next so it does not guess.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  turbopack: { root: new URL("../..", import.meta.url).pathname },
};

export default nextConfig;
