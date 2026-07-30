import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEBHOOK_TOLERANCE_MS,
  verifyWebhookSignature,
  WebhookVerificationError,
} from "../src";

// Underscores keep this out of the `whsec_[A-Za-z0-9]{32,}` shape that secret
// scanners flag as a Stripe/webhook signing secret — it's a fixture, not a
// credential. HMAC is computed over the raw bytes, so any string exercises it.
const SECRET = "whsec_test_fixture_not_a_real_signing_secret";

async function sign(payload: string, timestamp: string, secret = SECRET): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  return `sha256=${Buffer.from(mac).toString("base64")}`;
}

function eventPayload(): string {
  return JSON.stringify({
    id: "del_1",
    type: "helpdesk.message_received",
    created_at: 1730000000000,
    workspace_id: "ws_1",
    data: {
      channel: "widget",
      channelConnectionId: null,
      conversation: {
        id: "conv_1",
        channel: "widget",
        channelConnectionId: null,
        status: "open",
        subject: null,
        assigneeUserId: null,
        contactId: null,
        visitorName: "Jane",
        visitorEmail: "jane@example.com",
        externalConversationId: null,
        channelAccountId: null,
        messageCount: 2,
        lastMessageAt: 1730000000000,
        createdAt: 1729990000000,
      },
      message: {
        id: "msg_1",
        authorType: "visitor",
        messageType: "chat",
        body: "Hello!",
        authorUserId: null,
        authorName: null,
        externalMessageId: null,
        deliveryStatus: null,
        deliveryError: null,
        createdAt: 1730000000000,
      },
    },
  });
}

async function expectVerificationError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(WebhookVerificationError);
    expect((err as WebhookVerificationError).code).toBe(code);
    expect((err as WebhookVerificationError).name).toBe("WebhookVerificationError");
  }
}

describe("verifyWebhookSignature", () => {
  it("returns the parsed typed event on a valid signature", async () => {
    const payload = eventPayload();
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);

    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("helpdesk.message_received");
    if (event.type === "helpdesk.message_received") {
      expect(event.data.message.body).toBe("Hello!");
      expect(event.data.conversation.visitorEmail).toBe("jane@example.com");
    }
    expect(event.workspace_id).toBe("ws_1");
  });

  it("discriminates event types in a switch", async () => {
    const payload = JSON.stringify({
      id: "del_2",
      type: "helpdesk.conversation_status_changed",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: {
        channel: "widget",
        channelConnectionId: null,
        conversation: { id: "conv_1" },
        status: "closed",
        previousStatus: "open",
      },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });

    switch (event.type) {
      case "helpdesk.conversation_status_changed":
        expect(event.data.status).toBe("closed");
        expect(event.data.previousStatus).toBe("open");
        break;
      default:
        expect.unreachable();
    }
  });

  it("rejects a signature header without the sha256= prefix", async () => {
    await expectVerificationError(
      verifyWebhookSignature({
        payload: "{}",
        timestamp: String(Date.now()),
        signature: "md5=abc",
        secret: SECRET,
      }),
      "malformed_header",
    );
  });

  it("rejects a missing signature header", async () => {
    await expectVerificationError(
      verifyWebhookSignature({
        payload: "{}",
        timestamp: String(Date.now()),
        signature: undefined as never,
        secret: SECRET,
      }),
      "malformed_header",
    );
  });

  it("rejects a non-string timestamp header", async () => {
    await expectVerificationError(
      verifyWebhookSignature({
        payload: "{}",
        timestamp: undefined as never,
        signature: "sha256=abc",
        secret: SECRET,
      }),
      "malformed_header",
    );
  });

  it("rejects an empty timestamp header", async () => {
    await expectVerificationError(
      verifyWebhookSignature({
        payload: "{}",
        timestamp: "",
        signature: "sha256=abc",
        secret: SECRET,
      }),
      "malformed_header",
    );
  });

  it("rejects a non-numeric timestamp header", async () => {
    await expectVerificationError(
      verifyWebhookSignature({
        payload: "{}",
        timestamp: "not-a-number",
        signature: "sha256=abc",
        secret: SECRET,
      }),
      "malformed_header",
    );
  });

  it("rejects timestamps older than the default 5-minute tolerance", async () => {
    const payload = eventPayload();
    const timestamp = String(Date.now() - DEFAULT_WEBHOOK_TOLERANCE_MS - 1000);
    const signature = await sign(payload, timestamp);
    await expectVerificationError(
      verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET }),
      "timestamp_out_of_tolerance",
    );
  });

  it("respects a custom toleranceMs", async () => {
    const payload = eventPayload();
    const timestamp = String(Date.now() - 10_000);
    const signature = await sign(payload, timestamp);
    await expectVerificationError(
      verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET, toleranceMs: 5000 }),
      "timestamp_out_of_tolerance",
    );
    // Same skew passes with a wide-enough tolerance.
    const event = await verifyWebhookSignature({
      payload,
      timestamp,
      signature,
      secret: SECRET,
      toleranceMs: 60_000,
    });
    expect(event.type).toBe("helpdesk.message_received");
  });

  it("rejects a signature that is not valid base64", async () => {
    await expectVerificationError(
      verifyWebhookSignature({
        payload: "{}",
        timestamp: String(Date.now()),
        signature: "sha256=!!!not-base64!!!",
        secret: SECRET,
      }),
      "invalid_signature",
    );
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const payload = eventPayload();
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp, "whsec_wrong_secret");
    await expectVerificationError(
      verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET }),
      "invalid_signature",
    );
  });

  it("rejects a signature over a tampered payload", async () => {
    const payload = eventPayload();
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const tampered = payload.replace("Hello!", "Send money");
    await expectVerificationError(
      verifyWebhookSignature({ payload: tampered, timestamp, signature, secret: SECRET }),
      "invalid_signature",
    );
  });

  it("rejects a valid signature over a non-JSON payload", async () => {
    const payload = "not json";
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    await expectVerificationError(
      verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET }),
      "invalid_payload",
    );
  });

  it("verifies a test.ping event", async () => {
    const payload = JSON.stringify({
      id: "del_test",
      type: "test.ping",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: { test: true, channel: "widget", channelConnectionId: null },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("test.ping");
  });

  it("exports the default tolerance constant", () => {
    expect(DEFAULT_WEBHOOK_TOLERANCE_MS).toBe(300_000);
  });
});
