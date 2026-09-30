import { vi } from "vitest";

/**
 * Several scripts under `scripts/` call `process.exit(code)` directly instead
 * of returning/throwing. Node's real `process.exit` halts the process
 * immediately; a naive `mockImplementation(() => undefined)` does not, so
 * script code keeps running past the exit call and produces misleading
 * assertions (see the `assert-openapi-sdk-coverage` and `secretlint-*`
 * scripts, which both have unguarded code after their `process.exit` calls).
 *
 * This mock throws instead, matching the control-flow effect of a real exit;
 * pair it with `expectProcessExit` (or a manual try/catch) to swallow the
 * expected throw at the call site.
 */
export class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

export function mockProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new ProcessExitError(typeof code === "number" ? code : 0);
  });
}

/**
 * Runs `fn` (typically a dynamic `import()` of a script under test) and
 * swallows a `ProcessExitError`, returning its code — or `null` if the
 * script ran to completion without exiting. Any other error rethrows.
 */
export async function expectProcessExit(fn: () => Promise<unknown>): Promise<number | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    if (error instanceof ProcessExitError) {
      return error.code;
    }
    throw error;
  }
}
