/**
 * `server-only` throws when it is imported outside a React Server Components
 * build, which a test runner is not. The `/next` modules import it on purpose
 * (a client bundle that reaches for them must fail); the tests stand it in
 * with nothing.
 */
export {};
