import { describe, expect, it } from "vitest";
import type { WebhookEventType } from "../src";
import {
  DEFAULT_WEBHOOK_TOLERANCE_MS,
  verifyWebhookSignature,
  WebhookVerificationError,
} from "../src";

// Compile-time: `WebhookEventType` must name EXACTLY the twelve types the
// server can deliver — a missing member fails this object literal (missing
// key), an extra one fails it too (unknown key). This is what makes a
// `switch (event.type)` exhaustiveness check trustworthy.
const EVERY_EVENT_TYPE: Record<WebhookEventType, true> = {
  "helpdesk.conversation_created": true,
  "helpdesk.conversation_assigned": true,
  "helpdesk.conversation_status_changed": true,
  "helpdesk.message_received": true,
  "helpdesk.message_sent": true,
  "helpdesk.message_delivery_updated": true,
  "helpdesk.message_deleted": true,
  "helpdesk.conversation_contact_linked": true,
  "helpdesk.conversation_contact_unlinked": true,
  "helpdesk.channel_connected": true,
  "helpdesk.channel_disconnected": true,
  "test.ping": true,
};

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
        expect(event.data.reason).toBeUndefined();
        break;
      default:
        expect.unreachable();
    }
  });

  it("narrows a reopen-by-message status change with its reason", async () => {
    const payload = JSON.stringify({
      id: "del_2b",
      type: "helpdesk.conversation_status_changed",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: {
        channel: "telegram",
        channelConnectionId: "conn_1",
        conversation: { id: "conv_1", status: "open" },
        status: "open",
        previousStatus: "snoozed",
        reason: "message_reopened",
      },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("helpdesk.conversation_status_changed");
    if (event.type === "helpdesk.conversation_status_changed") {
      expect(event.data.status).toBe("open");
      expect(event.data.previousStatus).toBe("snoozed");
      expect(event.data.reason).toBe("message_reopened");
      expect(event.data.conversation.status).toBe("open");
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

  it("verifies and narrows a helpdesk.channel_connected event", async () => {
    const payload = JSON.stringify({
      id: "del_ch_1",
      type: "helpdesk.channel_connected",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: {
        channel: "telegram",
        channelConnectionId: "conn_1",
        channel_type: "telegram_inbox",
        connection_ref: "sess_1",
        label: "Acme support",
        masked_identity: "+47 •• •• 123",
      },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("helpdesk.channel_connected");
    if (event.type === "helpdesk.channel_connected") {
      expect(event.data.channel_type).toBe("telegram_inbox");
      expect(event.data.connection_ref).toBe("sess_1");
      expect(event.data.masked_identity).toBe("+47 •• •• 123");
    }
  });

  it("verifies and narrows a helpdesk.channel_disconnected event with a reason", async () => {
    const payload = JSON.stringify({
      id: "del_ch_2",
      type: "helpdesk.channel_disconnected",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: {
        channel: "telegram",
        channelConnectionId: "conn_1",
        channel_type: "telegram_inbox",
        connection_ref: "sess_1",
        label: null,
        masked_identity: null,
        reason: "api_disconnect",
      },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("helpdesk.channel_disconnected");
    if (event.type === "helpdesk.channel_disconnected") {
      expect(event.data.reason).toBe("api_disconnect");
    }
  });

  it("verifies and narrows a helpdesk.message_deleted event whose body is empty", async () => {
    const payload = JSON.stringify({
      id: "del_md_1",
      type: "helpdesk.message_deleted",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: {
        channel: "telegram",
        channelConnectionId: "conn_1",
        conversation: { id: "conv_1", channel: "telegram", chatType: "private" },
        message: { id: "msg_1", authorType: "visitor", messageType: "chat", body: "" },
        deletedAt: 1730000001000,
        deletedBy: "external",
      },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("helpdesk.message_deleted");
    if (event.type === "helpdesk.message_deleted") {
      expect(event.data.message.body).toBe("");
      expect(event.data.deletedAt).toBe(1730000001000);
      expect(event.data.deletedBy).toBe("external");
      expect(event.data.conversation.chatType).toBe("private");
    }
  });

  it("verifies and narrows a helpdesk.conversation_contact_linked event", async () => {
    const payload = JSON.stringify({
      id: "del_cl_1",
      type: "helpdesk.conversation_contact_linked",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: {
        channel: "telegram",
        channelConnectionId: "conn_1",
        conversation: { id: "conv_1", contactId: "c_2", contactLinkSource: "partner" },
        contactId: "c_2",
        previousContactId: "c_1",
        contactEmail: "ida@example.com",
        contactName: "Ida Nordmann",
        linkSource: "partner",
        linkedAt: 1730000002000,
        externalContactRef: "tg:12345",
      },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("helpdesk.conversation_contact_linked");
    if (event.type === "helpdesk.conversation_contact_linked") {
      expect(event.data.contactId).toBe("c_2");
      expect(event.data.previousContactId).toBe("c_1");
      expect(event.data.contactEmail).toBe("ida@example.com");
      expect(event.data.linkSource).toBe("partner");
      expect(event.data.conversation.contactLinkSource).toBe("partner");
    }
  });

  it("verifies and narrows a helpdesk.conversation_contact_unlinked event", async () => {
    const payload = JSON.stringify({
      id: "del_cu_1",
      type: "helpdesk.conversation_contact_unlinked",
      created_at: Date.now(),
      workspace_id: "ws_1",
      data: {
        channel: "telegram",
        channelConnectionId: "conn_1",
        conversation: { id: "conv_1", contactId: null, contactLinkSource: null },
        contactId: null,
        previousContactId: "c_2",
        linkSource: "operator",
        unlinkedAt: 1730000003000,
        externalContactRef: null,
      },
    });
    const timestamp = String(Date.now());
    const signature = await sign(payload, timestamp);
    const event = await verifyWebhookSignature({ payload, timestamp, signature, secret: SECRET });
    expect(event.type).toBe("helpdesk.conversation_contact_unlinked");
    if (event.type === "helpdesk.conversation_contact_unlinked") {
      expect(event.data.contactId).toBeNull();
      expect(event.data.previousContactId).toBe("c_2");
      expect(event.data.unlinkedAt).toBe(1730000003000);
    }
  });

  it("names every deliverable event type exactly once", () => {
    expect(Object.keys(EVERY_EVENT_TYPE)).toHaveLength(12);
  });

  it("exports the default tolerance constant", () => {
    expect(DEFAULT_WEBHOOK_TOLERANCE_MS).toBe(300_000);
  });
});
