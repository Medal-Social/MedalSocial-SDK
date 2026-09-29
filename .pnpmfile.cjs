// TypeScript 7 is the native (Go) port and ships no legacy JS compiler API.
// typedoc and openapi-typescript still `require("typescript")` for that API
// (ts.SyntaxKind / ts.factory), and both declare it as a *peer* — so pnpm would
// hand them the project's TS 7 and they would crash.
//
// Neither `packageExtensions` nor a scoped `overrides` entry can change what a
// peer resolves to, so this hook rewrites their manifests instead: the peer
// becomes a real dependency on the official TS 6 API package. The project
// itself (tsc, tsdown's declaration build) runs on TS 7.
//
// Delete a name from this list once that tool supports TS 7; delete the file
// when the list is empty.
const NEEDS_TS6_API = new Set(["typedoc", "openapi-typescript"]);
const TS6_API = "npm:@typescript/typescript6@^6.0.2";

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (NEEDS_TS6_API.has(pkg.name)) {
        delete pkg.peerDependencies?.typescript;
        delete pkg.peerDependenciesMeta?.typescript;
        pkg.dependencies = { ...pkg.dependencies, typescript: TS6_API };
      }
      return pkg;
    },
  },
};
