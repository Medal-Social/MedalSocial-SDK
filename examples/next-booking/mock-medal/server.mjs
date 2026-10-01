/**
 * A stand-in for Medal's booking API: one service, one stylist, a few free
 * slots tomorrow, and a create / manage pair that remembers what it booked.
 * Answers in Medal's envelopes (`{ data }`, `{ error: { code, message } }`).
 *
 * Invented data only — «Salong Demo» is nobody.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_MEDAL_PORT ?? 3101);
const HOUR = 60 * 60 * 1000;

const SERVICE = {
  id: "svc-demo-cut",
  name: "Barneklipp",
  description: "Klipp for barn",
  category: "barn",
  duration_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  price_ore: 45_000,
  bookable_online: true,
  max_per_booking: 3,
  weekend_surcharge_pct: null,
  age_min_years: null,
  age_max_years: null,
};

const STYLIST = {
  id: "res-demo-1",
  name: "Kari",
  photo_url: null,
  bio: "Rolig med de minste",
  service_ids: [SERVICE.id],
  sort_order: 1,
};

/** Tomorrow 10:00, 10:30 and 11:00 UTC — inside any seven-day window. */
function slots() {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCHours(10, 0, 0, 0);
  return [0, 0.5, 1].map((offset) => {
    const start = day.getTime() + offset * HOUR;
    return {
      start_ts: new Date(start).toISOString(),
      end_ts: new Date(start + HOUR / 2).toISOString(),
      resource_id: STYLIST.id,
    };
  });
}

/** Booked appointments by manage token. */
const booked = new Map();

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function json(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  if (path === "/health") return send(response, 200, { ok: true });
  if (request.headers.authorization !== "Bearer sk_example") {
    return send(response, 401, { error: { code: "UNAUTHORIZED", message: "bad key" } });
  }
  if (request.method === "GET" && path === "/api/v1/bookings/services") {
    return send(response, 200, { data: [SERVICE] });
  }
  if (request.method === "GET" && path === "/api/v1/bookings/resources") {
    return send(response, 200, { data: [STYLIST] });
  }
  if (request.method === "GET" && path === "/api/v1/bookings/availability") {
    return send(response, 200, { data: slots() });
  }
  if (request.method === "GET" && path === "/api/v1/bookings/schedule") {
    const [first] = slots();
    const opens = new Date(first.start_ts);
    opens.setUTCHours(7);
    const closes = new Date(first.start_ts);
    closes.setUTCHours(15);
    return send(response, 200, {
      data: [
        {
          date: first.start_ts.slice(0, 10),
          opens_ts: opens.toISOString(),
          closes_ts: closes.toISOString(),
          last_start_ts: new Date(closes.getTime() - HOUR / 2).toISOString(),
        },
      ],
    });
  }
  if (request.method === "POST" && path === "/api/v1/bookings") {
    const body = await json(request);
    if (body.created_via !== "web") {
      return send(response, 422, { error: { code: "VALIDATION_ERROR", message: "created_via" } });
    }
    const bookings = body.items.map((item, index) => {
      const manage = token();
      booked.set(manage, { ...item, id: `bk-${booked.size + index + 1}` });
      return { id: booked.get(manage).id, manage_token: manage };
    });
    return send(response, 201, { data: { bookings, contact_id: "ct-demo" } });
  }
  const manage = path.match(/^\/api\/v1\/bookings\/manage\/([^/]+)$/);
  if (request.method === "GET" && manage) {
    const found = booked.get(decodeURIComponent(manage[1]));
    if (!found) return send(response, 404, { error: { code: "NOT_FOUND", message: "unknown" } });
    const start = new Date(found.start_ts);
    return send(response, 200, {
      data: {
        booking_id: found.id,
        contact_id: "ct-demo",
        status: "confirmed",
        cancelled_by: null,
        cancel_reason: null,
        rescheduled_from_id: null,
        start_ts: start.toISOString(),
        end_ts: new Date(start.getTime() + HOUR / 2).toISOString(),
        service_id: SERVICE.id,
        service_name: SERVICE.name,
        resource_id: STYLIST.id,
        resource_name: STYLIST.name,
        booked_for_name: null,
        party_sequence_id: null,
        amount_ore: SERVICE.price_ore,
        payment_status: "none",
        payment_mode: "none",
        time_zone: "Europe/Oslo",
        cancel_window_hours: 24,
        reschedule_window_hours: 24,
        can_cancel: true,
        can_reschedule: true,
      },
    });
  }
  return send(response, 404, { error: { code: "NOT_FOUND", message: `No route ${path}` } });
});

server.listen(PORT, () => {
  console.log(`mock Medal on http://localhost:${PORT}`);
});
