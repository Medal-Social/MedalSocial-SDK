import type { RequestOptions } from "./client";
import { resolveIdempotencyKey } from "./client";
import type { CapabilityConfirmations } from "./resources/capability-confirmations";
import type {
  AutoConfirmOptions,
  CapabilityPathParamValue,
  CapabilityWriteRequest,
} from "./types/capabilities";
import { CAPABILITY_ROUTES } from "./types/capabilities";

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
   *
   * `body` is the pending request payload (`undefined` for `DELETE` routes).
   * It is handed to the `previewSummary` callback by reference so the summary
   * can describe the specific action, not just the route — it is the caller's
   * own payload, so it is passed through unmodified and unredacted.
   */
  async prepare(
    request: CapabilityWriteRequest,
    pathParams?: Record<string, CapabilityPathParamValue>,
    options?: RequestOptions,
  ): Promise<RequestOptions | undefined> {
    const auto =
      options?.autoConfirm === false ? undefined : (options?.autoConfirm ?? this.defaults);
    if (!auto) return options;

    // Resolve the key the SAME way the write itself will, so the value bound
    // into the token is the value that reaches the server. A blank key resolves
    // to a fresh one here exactly as it would at POST time — binding the blank
    // and sending the replacement would produce a token the server refuses.
    const idempotencyKey = resolveIdempotencyKey(options?.idempotencyKey);
    const callerKeyIsUsable = idempotencyKey === options?.idempotencyKey;

    // Nothing to mint — the caller already brought both halves. A blank key is
    // not a half: the token paired with it was bound to a value the server can
    // never receive, so re-mint rather than send a doomed pair.
    if (callerKeyIsUsable && options?.capabilityConfirmation) return options;

    const route = CAPABILITY_ROUTES[request.capabilityId];
    const path = resolvePath(route.path_template, pathParams);

    const previewSummary = auto.previewSummary({
      ...request,
      method: route.method,
      path,
      ...(pathParams ? { pathParams } : {}),
      idempotencyKey,
    });
    if (typeof previewSummary !== "string" || previewSummary.trim() === "") {
      throw new Error(
        `autoConfirm.previewSummary must return a non-empty summary for ${request.capabilityId}. ` +
          "The summary is the audit record of what your user approved — refusing to assert " +
          "user_approved: true without one.",
      );
    }

    const { data } = await this.confirmations.create({
      capability_id: request.capabilityId,
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
