import type { RequestOptions } from "./client";
import type { CapabilityConfirmations } from "./resources/capability-confirmations";
import type {
  AutoConfirmOptions,
  CapabilityId,
  CapabilityPathParamValue,
} from "./types/capabilities";
import { CAPABILITY_ROUTES } from "./types/capabilities";

function newIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  /* v8 ignore next 2 -- fallback for runtimes without WebCrypto randomUUID */
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function resolvePath(
  template: string,
  pathParams?: Record<string, CapabilityPathParamValue>,
): string {
  return template.replace(/\{([^}/]+)\}/g, (_match, name: string) => {
    const value = pathParams?.[name];
    return value === undefined ? `{${name}}` : encodeURIComponent(String(value));
  });
}

/**
 * Resolves the `Idempotency-Key` + `X-Capability-Confirmation` pair required
 * by confirmable write routes.
 *
 * Auto-confirmation is OFF unless the integrator opts in — either globally via
 * the `Medal` constructor's `autoConfirmCapabilities`, or per call via
 * `{ autoConfirm: { previewSummary } }`. When it is off this is a pass-through:
 * whatever headers the caller supplied are what gets sent.
 */
export class CapabilityConfirmer {
  constructor(
    private confirmations: CapabilityConfirmations,
    private defaults?: AutoConfirmOptions,
  ) {}

  /**
   * Return the request options to use for a confirmable write, minting the
   * idempotency key and confirmation token first when auto-confirm is active.
   */
  async prepare(
    capabilityId: CapabilityId,
    pathParams?: Record<string, CapabilityPathParamValue>,
    options?: RequestOptions,
  ): Promise<RequestOptions | undefined> {
    const auto =
      options?.autoConfirm === false ? undefined : (options?.autoConfirm ?? this.defaults);
    if (!auto) return options;
    // Nothing to mint — the caller already brought both halves.
    if (options?.idempotencyKey && options?.capabilityConfirmation) return options;

    const route = CAPABILITY_ROUTES[capabilityId];
    const idempotencyKey = options?.idempotencyKey ?? newIdempotencyKey();
    const path = resolvePath(route.path_template, pathParams);

    const previewSummary = auto.previewSummary({
      capabilityId,
      method: route.method,
      path,
      ...(pathParams ? { pathParams } : {}),
      idempotencyKey,
    });
    if (typeof previewSummary !== "string" || previewSummary.trim() === "") {
      throw new Error(
        `autoConfirm.previewSummary must return a non-empty summary for ${capabilityId}. ` +
          "The summary is the audit record of what your user approved — refusing to assert " +
          "user_approved: true without one.",
      );
    }

    const { data } = await this.confirmations.create({
      capability_id: capabilityId,
      ...(pathParams ? { path_params: pathParams } : {}),
      idempotency_key: idempotencyKey,
      preview_summary: previewSummary,
      user_approved: true,
    });

    return {
      ...options,
      idempotencyKey,
      capabilityConfirmation: data.confirmation_token,
    };
  }
}
