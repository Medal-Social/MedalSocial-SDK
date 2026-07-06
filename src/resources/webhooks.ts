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

/** Manage webhook endpoints and inspect their deliveries. */
export class Webhooks {
  constructor(private client: BaseClient) {}

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
   */
  async create(
    input: CreateWebhookInput,
    options?: RequestOptions,
  ): Promise<ApiResponse<WebhookEndpoint & { secret: string }>> {
    return this.client.post("/api/v1/webhooks", input, options);
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
    return this.client.patch(`/api/v1/webhooks/${encodeURIComponent(id)}`, input, options);
  }

  /**
   * Permanently delete a webhook endpoint (stops all outbound deliveries).
   * Capability-scoped tokens must pass `idempotencyKey` — the API requires
   * `Idempotency-Key` + `X-Capability-Confirmation` for direct capability
   * grants on this route. API keys with legacy scopes may omit it.
   */
  async delete(id: string, options?: RequestOptions): Promise<ApiResponse<WebhookDeleteResult>> {
    return this.client.delete(`/api/v1/webhooks/${encodeURIComponent(id)}`, options);
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

  /** Queue a signed `test.ping` delivery to the endpoint. Returns HTTP 202. */
  async test(id: string): Promise<ApiResponse<WebhookTestResult>> {
    return this.client.post(`/api/v1/webhooks/${encodeURIComponent(id)}/test`);
  }
}
