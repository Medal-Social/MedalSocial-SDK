import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ContactStatus,
  DealStatus,
  PortalLocale,
  PostStatus,
  SubscribableWebhookEventType,
} from "../src";
import { Medal } from "../src";

// Compile-time guards: the closed unions must REJECT the values the SDK used
// to advertise, because the API always answered them with a 400. Each line
// fails `pnpm typecheck` (tsconfig.test.json) if the union widens again.
// @ts-expect-error - `won` was never a deal status the API accepts
const _staleDealStatus: DealStatus = "won";
// @ts-expect-error - `prospect` was never a contact status the API accepts
const _staleContactStatus: ContactStatus = "prospect";
// @ts-expect-error - the portal accepts `no`, not `nb`
const _staleLocale: PortalLocale = "nb";
// @ts-expect-error - `test.ping` cannot be subscribed to
const _pingSubscription: SubscribableWebhookEventType = "test.ping";
// @ts-expect-error - post status is a closed set
const _stalePostStatus: PostStatus = "live";
void _staleDealStatus;
void _staleContactStatus;
void _staleLocale;
void _pingSubscription;
void _stalePostStatus;

const BASE = "https://test.convex.site";

function mockPage() {
  return new Response(
    JSON.stringify({ data: [], pagination: { has_more: false, next_cursor: null } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Captures the query string of the one GET the call under test makes. */
function captureQuery(): { params: () => URLSearchParams } {
  let captured: URL | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    captured = new URL(url as string);
    return mockPage();
  });
  return {
    params: () => {
      if (!captured) throw new Error("fetch was not called");
      return captured.searchParams;
    },
  };
}

describe("list filters the API accepts", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deals.list serialises every filter", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.deals.list({
      status: "offer_sent",
      search: "Acme",
      close_date_from: "2026-07-01T00:00:00.000Z",
      close_date_to: 1785456000000,
      min_value: 25000,
      company_name: "Acme",
      contact_id: "c_1",
      stage: "offer sent",
    });
    const params = query.params();
    expect(params.get("status")).toBe("offer_sent");
    expect(params.get("search")).toBe("Acme");
    expect(params.get("close_date_from")).toBe("2026-07-01T00:00:00.000Z");
    expect(params.get("close_date_to")).toBe("1785456000000");
    expect(params.get("min_value")).toBe("25000");
    expect(params.get("company_name")).toBe("Acme");
    expect(params.get("contact_id")).toBe("c_1");
    expect(params.get("stage")).toBe("offer sent");
  });

  it("deals.list sends min_value: 0 rather than dropping it", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.deals.list({ min_value: 0 });
    expect([...query.params().keys()]).toEqual(["min_value"]);
    expect(query.params().get("min_value")).toBe("0");
  });

  it("contacts.list sends email as an exact-match filter", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.contacts.list({ email: "ida@example.com" });
    expect([...query.params().keys()]).toEqual(["email"]);
    expect(query.params().get("email")).toBe("ida@example.com");
  });

  it("posts.list serialises every filter (platforms as CSV)", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.posts.list({
      status: "scheduled",
      type: "social",
      scheduled_from: "2026-07-01T00:00:00.000Z",
      scheduled_to: 1783296000000,
      published_from: 1780000000000,
      published_to: "2026-08-01T00:00:00.000Z",
      platforms: ["linkedin", "x"],
      query: "launch",
    });
    const params = query.params();
    expect(params.get("status")).toBe("scheduled");
    expect(params.get("type")).toBe("social");
    expect(params.get("scheduled_from")).toBe("2026-07-01T00:00:00.000Z");
    expect(params.get("scheduled_to")).toBe("1783296000000");
    expect(params.get("published_from")).toBe("1780000000000");
    expect(params.get("published_to")).toBe("2026-08-01T00:00:00.000Z");
    expect(params.get("platforms")).toBe("linkedin,x");
    expect(params.get("query")).toBe("launch");
  });

  it("posts.list sends nothing for filters that were not given", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.posts.list({ status: "draft" });
    expect([...query.params().keys()]).toEqual(["status"]);
  });

  it("bookings.list sends created_via", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.bookings.list({ created_via: "walk_in" });
    expect([...query.params().keys()]).toEqual(["created_via"]);
    expect(query.params().get("created_via")).toBe("walk_in");
  });

  it("helpdesk.conversations.list sends chat_type and assigned", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.helpdesk.conversations.list({ chat_type: "group", assigned: true });
    expect(query.params().get("chat_type")).toBe("group");
    expect(query.params().get("assigned")).toBe("true");
  });

  it("helpdesk.conversations.list sends assigned: false — the triage question", async () => {
    const query = captureQuery();
    const medal = new Medal("medal_test", { baseUrl: BASE });
    await medal.helpdesk.conversations.list({ assigned: false });
    expect([...query.params().keys()]).toEqual(["assigned"]);
    expect(query.params().get("assigned")).toBe("false");
  });
});
