import { CapabilityConfirmer } from "../capability-confirmer";
import type { BaseClient, RequestOptions } from "../client";
import type { ApiResponse } from "../types/common";
import type {
  CreateWebhookInput,
  ListDeliveriesOptions,
  UpdateWebhookInput,
  WebhookDeleteResult,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookTestResult,
} from "../types/webhooks";
import { CapabilityConfirmations } from "./capability-confirmations";

/** Manage webhook endpoints and inspect their deliveries. */
export class Webhooks {
  private confirmer: CapabilityConfirmer;

  constructor(
    private client: BaseClient,
    confirmer?: CapabilityConfirmer,
  ) {
    // Direct consumers (`new Webhooks(client)`) get a confirmer with no
    // client-level default: auto-confirm stays off unless a call opts in via
    // `{ autoConfirm: { previewSummary } }`.
    this.confirmer = confirmer ?? new CapabilityConfirmer(new CapabilityConfirmations(client));
  }

  /** List all webhook endpoints in the workspace. */
  async list(): Promise<ApiResponse<WebhookEndpoint[]>> {
    return this.client.get("/api/v1/webhooks");
  }

  /**
   * Create a webhook endpoint. Returns HTTP 201.
   *
   * **The response's `data.secret` contains the signing secret EXACTLY ONCE.**
   * It can never be retrieved again — store it securely immediately. You need
   * it to verify the `X-Medal-Signature` header on incoming deliveries (see
   * `verifyWebhookSignature`).
   *
   * `secret` is typed optional because an idempotent replay (retrying with the
   * same `Idempotency-Key`, `X-Idempotent-Replayed: true`) returns the existing
   * endpoint WITHOUT the secret — handle that case (rotate if you lost it).
   *
   * Automatically idempotent: a duplicate endpoint is not a stray row, it is a
   * second copy of every future delivery to the same URL, forever. The key the
   * confirmer chose is the key that goes out — a capability confirmation is
   * bound to its idempotency key, so minting a fresh one here would invalidate
   * the confirmation. That the SDK now always sends a key is also what makes
   * the replay-without-secret case above reachable on a plain 5xx retry.
   */
  async create(
    input: CreateWebhookInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<WebhookEndpoint>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "helpdesk.webhook.create.execute", body: input },
      undefined,
      options,
    );
    return this.client.postOnce("/api/v1/webhooks", input, resolved);
  }

  /** Get a webhook endpoint by ID. */
  async get(id: string): Promise<ApiResponse<WebhookEndpoint>> {
    return this.client.get(`/api/v1/webhooks/${encodeURIComponent(id)}`);
  }

  /** Update a webhook endpoint (name, url, event types, filters, enabled). */
  async update(
    id: string,
    input: UpdateWebhookInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<WebhookEndpoint>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "helpdesk.webhook.update.execute", body: input },
      { id },
      options,
    );
    return this.client.patch(`/api/v1/webhooks/${encodeURIComponent(id)}`, input, resolved);
  }

  /**
   * Permanently delete a webhook endpoint (stops all outbound deliveries).
   * Capability-scoped tokens must pass `idempotencyKey` — the API requires
   * `Idempotency-Key` + `X-Capability-Confirmation` for direct capability
   * grants on this route. API keys with legacy scopes may omit it.
   */
  async delete(id: string, options?: RequestOptions): Promise<ApiResponse<WebhookDeleteResult>> {
    const resolved = await this.confirmer.prepare(
      { capabilityId: "helpdesk.webhook.delete.execute", body: undefined },
      { id },
      options,
    );
    return this.client.delete(`/api/v1/webhooks/${encodeURIComponent(id)}`, resolved);
  }

  /** List recent deliveries for an endpoint (most recent first). */
  async deliveries(
    id: string,
    options?: ListDeliveriesOptions,
  ): Promise<ApiResponse<WebhookDelivery[]>> {
    const params: Record<string, string | undefined> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    return this.client.get(`/api/v1/webhooks/${encodeURIComponent(id)}/deliveries`, params);
  }

  /**
   * Queue a signed `test.ping` delivery to the endpoint. Returns HTTP 202.
   *
   * Deliberately unkeyed: a duplicate ping is the one duplicate that costs
   * nothing. Real deliveries are retried too, so any endpoint worth pointing at
   * already tolerates receiving the same event twice — that is what this call
   * exists to prove.
   */
  async test(id: string): Promise<ApiResponse<WebhookTestResult>> {
    return this.client.post(`/api/v1/webhooks/${encodeURIComponent(id)}/test`);
  }
}
