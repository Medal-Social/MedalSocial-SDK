import type { BaseClient } from "../client";
import type {
  CapabilityConfirmation,
  IssueCapabilityConfirmationInput,
} from "../types/capabilities";
import type { ApiResponse } from "../types/common";

/**
 * Mint short-lived capability confirmation tokens.
 *
 * Medal's confirmable write routes (connect links, channel connections,
 * helpdesk replies/updates, webhook endpoint writes) require BOTH an
 * `Idempotency-Key` and an `X-Capability-Confirmation` header when the calling
 * credential holds the capability scope *directly* — which is the case for
 * every correctly-scoped partner key. This resource issues that header value.
 *
 * @example Explicit flow
 * ```ts
 * const idempotencyKey = crypto.randomUUID();
 * const { data: confirmation } = await medal.capabilityConfirmations.create({
 *   capability_id: 'channel.connect_link.create.execute',
 *   idempotency_key: idempotencyKey,
 *   preview_summary: 'Mint a Telegram connect link for Acme Support',
 *   user_approved: true, // a human on your side approved this exact action
 * });
 *
 * await medal.channels.connectLinks.create(
 *   { channel_type: 'telegram_inbox', label: 'Acme Support' },
 *   { idempotencyKey, capabilityConfirmation: confirmation.confirmation_token },
 * );
 * ```
 */
export class CapabilityConfirmations {
  constructor(private client: BaseClient) {}

  /**
   * Issue a confirmation token for one pending write.
   *
   * The token is bound to the workspace, the auth subject, the capability's
   * method + path, its required scopes, and `idempotency_key` — so it is
   * usable exactly once, for exactly the write it describes, and expires
   * within 15 minutes.
   *
   * Setting `user_approved: true` asserts that a human on your side approved
   * this specific action. `preview_summary` is what they approved, and is
   * retained for audit — write it for a human reader, not a log parser.
   *
   * Deliberately unkeyed, unlike the writes it authorizes. Minting is not the
   * state change the guarantee exists to protect: the write itself is already
   * bound to `idempotency_key`, so a retry that mints a second token cannot
   * produce a second write. Keying this call would instead park a credential
   * designed to expire in 15 minutes inside a replay cache that answers for 24
   * hours — a worse trade than the duplicate token it would avoid.
   */
  async create(
    input: IssueCapabilityConfirmationInput,
  ): Promise<ApiResponse<CapabilityConfirmation>> {
    return this.client.post("/api/v1/capability-confirmations", input);
  }
}
