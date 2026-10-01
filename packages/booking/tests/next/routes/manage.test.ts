import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedalApiError } from '../../../src/next/medal';
import { manageRoute } from '../../../src/next/routes/manage';
import { testRuntime } from '../../support/next-runtime';

/** The Medal seam's three manage calls. */
const cancelManage = vi.fn();
const rescheduleManage = vi.fn();
const getManage = vi.fn();

/** The slot cache. What it does with the ids is the catalogue tests'. */
const expireSlots = vi.fn();

/** This colo's booking seeds; what it deletes is the seed tests'. */
const expireBookingSeeds = vi.fn();

const loggerError = vi.fn();
const logger = {
  error: (...args: unknown[]) => loggerError(...args),
  warn: vi.fn(),
  info: vi.fn(),
};

const rt = testRuntime(
  {
    medal: { cancelManage, rescheduleManage, getManage } as never,
    catalogue: { expireSlots } as never,
    seed: { expireBookingSeeds } as never,
  },
  { logger }
);

const POST = async (request: Request, context: { params: Promise<{ token: string }> }) =>
  manageRoute(rt, request, (await context.params).token);

/** A plausible live manage token — opaque, and a bearer credential for one
 * booking. Every assertion about where it must NOT appear reads this. */
const TOKEN = 'mt_live_2f8a9c1b4d6e';

function post(body: unknown, token = TOKEN) {
  return POST(
    new Request(`https://salong.example/api/booking/manage/${token}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rescheduleManage).mockResolvedValue({});
  vi.mocked(cancelManage).mockResolvedValue({});
  vi.mocked(getManage).mockResolvedValue({ service_id: 'svc-gutt' } as never);
});

describe('POST /api/booking/manage/[token]', () => {
  it('relays a cancellation, and the reason only when there is one', async () => {
    const anyKey = expect.stringMatching(/^[0-9a-f]{64}$/);

    await post({ action: 'cancel' });
    expect(cancelManage).toHaveBeenCalledWith(TOKEN, undefined, anyKey);

    // Blank is not «absent» to this API — the engine stores whatever it is
    // given, and a reason of «» is a record that says nothing.
    await post({ action: 'cancel', reason: '   ' });
    expect(cancelManage).toHaveBeenLastCalledWith(TOKEN, undefined, anyKey);

    await post({ action: 'cancel', reason: ' Sykdom ' });
    expect(cancelManage).toHaveBeenLastCalledWith(TOKEN, 'Sykdom', anyKey);
  });

  it('derives one cancellation key per booking, so a retry replays', async () => {
    // Cancelling twice is a CONFLICT — the second call finds a booking that is
    // already cancelled — so a dropped RESPONSE turns the visitor's retry into
    // «det gikk ikke» for an appointment that IS cancelled. The key makes the
    // retry a replay.
    await post({ action: 'cancel' });
    await post({ action: 'cancel', reason: 'Sykdom' });

    const [first, second] = vi.mocked(cancelManage).mock.calls;
    // The same booking is the same cancellation whatever reason was given the
    // second time — and the first reason is the one that sticks, which is the
    // one the visitor gave before anything went wrong.
    expect(second[2]).toBe(first[2]);
    // The digest and never the token: Medal stores the request identity against
    // the key, and a plaintext token there outlives the appointment.
    expect(first[2]).not.toContain(TOKEN);
  });

  it('refuses a start time that is not one, before Medal is asked', async () => {
    // `Number(null)` is 0, so a lenient parse would move the appointment to
    // 1 January 1970 rather than answering.
    const response = await post({ action: 'reschedule', startTs: null });
    expect(response.status).toBe(400);
    expect(rescheduleManage).not.toHaveBeenCalled();
  });

  it('relays the new booking’s token so the page has a link that still works', async () => {
    vi.mocked(rescheduleManage).mockResolvedValue({ manage_token: 'mt_live_next' });
    const response = await post({ action: 'reschedule', startTs: 1_791_453_600_000 });

    expect(rescheduleManage).toHaveBeenCalledWith(TOKEN, 1_791_453_600_000, expect.any(String));
    expect(await response.json()).toEqual({ ok: true, manageToken: 'mt_live_next' });
  });

  it('omits the field entirely when the engine replayed and sent none', async () => {
    // `manage_token` is minted exactly once. `manageToken: undefined` would
    // serialise away anyway, but «absent» is what the page branches on.
    const response = await post({ action: 'reschedule', startTs: 1 });
    expect(await response.json()).toEqual({ ok: true });
  });

  /**
   * The key has to be the same for a retry of the same move and different for a
   * different one — otherwise a double-tapped «Bekreft endring» is either a
   * second reschedule or a replay of somebody else's.
   */
  it('derives one idempotency key per (booking, new time)', async () => {
    await post({ action: 'reschedule', startTs: 1_791_453_600_000 });
    await post({ action: 'reschedule', startTs: 1_791_453_600_000 });
    await post({ action: 'reschedule', startTs: 1_791_457_200_000 });
    await post({ action: 'reschedule', startTs: 1_791_453_600_000 }, 'mt_live_other');

    const keys = vi.mocked(rescheduleManage).mock.calls.map((call) => call[2]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  /**
   * Medal stores the request identity against the key, so a plaintext token
   * there would write a live credential into a table that outlives the
   * appointment — the same reason the engine hashes the token out of its own
   * idempotency identity and API log.
   */
  it('never puts the token itself in the idempotency key', async () => {
    await post({ action: 'reschedule', startTs: 1 });
    const key = vi.mocked(rescheduleManage).mock.calls[0][2];
    expect(key).not.toContain(TOKEN);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * The window is the engine's to enforce, and it raises `CONFLICT` with
   * `CANCEL_WINDOW_PASSED` in the MESSAGE — the code alone cannot tell it from a
   * taken slot. It is reachable without anyone doing anything wrong: the page
   * rendered while `can_cancel` was true and the visitor sat on it.
   */
  it('tells a late cancellation apart from every other conflict', async () => {
    vi.mocked(cancelManage).mockRejectedValueOnce(
      new MedalApiError(
        409,
        'CONFLICT',
        'CANCEL_WINDOW_PASSED: bookings can be cancelled up to 24h'
      )
    );
    const late = await post({ action: 'cancel' });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: 'windowPassed' });

    vi.mocked(rescheduleManage).mockRejectedValueOnce(
      new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN: the requested time is no longer available')
    );
    const taken = await post({ action: 'reschedule', startTs: 1 });
    expect(await taken.json()).toEqual({ error: 'slotTaken' });

    vi.mocked(cancelManage).mockRejectedValueOnce(
      new MedalApiError(409, 'CONFLICT', 'Only confirmed bookings can be cancelled')
    );
    expect(await (await post({ action: 'cancel' })).json()).toEqual({ error: 'conflict' });
  });

  /** An unknown token, a GDPR-erased booking and another salon's token are one
   * answer here, exactly as they are one answer upstream. */
  it('answers 404 without saying which kind of 404 it was', async () => {
    vi.mocked(cancelManage).mockRejectedValueOnce(
      new MedalApiError(404, 'NOT_FOUND', 'Booking not found')
    );
    const response = await post({ action: 'cancel' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'notFound' });
  });

  /**
   * The token is a live credential. Nothing here may echo it, and nothing here
   * may log it — a log stream outlives the appointment, and Medal's own error
   * bodies are written for whoever holds the API key.
   *
   * The log line is checked by its FIELDS rather than by searching a serialised
   * blob: a pino serializer expands `err` into its message, and `Error.message`
   * is not an own enumerable property, so a `JSON.stringify` search would pass
   * against a route that logged the token inside the error. What this route owes
   * is that it adds nothing but `action`; keeping the token out of the message
   * is `safePath`'s job in `medal-client.ts`, and is tested there.
   */
  it('keeps the token out of every response body and every log line', async () => {
    vi.mocked(cancelManage).mockRejectedValueOnce(
      new MedalApiError(500, 'INTERNAL', `Upstream blew up for ${TOKEN}`)
    );
    const failed = await post({ action: 'cancel' });
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain(TOKEN);

    expect(loggerError).toHaveBeenCalledWith(expect.anything(), 'Booking manage action failed');
    const logged = loggerError.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(logged).sort()).toEqual(['action', 'err']);
    expect(logged.action).toBe('cancel');

    const bad = await post({ action: 'nonsense' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain(TOKEN);
  });

  it('does not act on a body it cannot read', async () => {
    const response = await POST(
      new Request(`https://salong.example/api/booking/manage/${TOKEN}`, {
        method: 'POST',
        body: 'not json',
      }),
      { params: Promise.resolve({ token: TOKEN }) }
    );
    expect(response.status).toBe(400);
    expect(cancelManage).not.toHaveBeenCalled();
    expect(rescheduleManage).not.toHaveBeenCalled();
  });
});

/**
 * A cancelled or moved appointment frees a slot (and a move takes one). The
 * thirty-second slot cache must not hide that from the next visitor.
 */
describe('POST /api/booking/manage/[token] — the slot cache', () => {
  it('expires the booking’s service once a cancellation lands', async () => {
    const response = await post({ action: 'cancel' });

    expect(response.status).toBe(200);
    expect(getManage).toHaveBeenCalledWith(TOKEN);
    expect(expireSlots).toHaveBeenCalledWith(['svc-gutt']);
    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc-gutt']);
  });

  it('expires the booking’s service once a move lands', async () => {
    const response = await post({ action: 'reschedule', startTs: 1_800_000_000_000 });

    expect(response.status).toBe(200);
    expect(expireSlots).toHaveBeenCalledWith(['svc-gutt']);
    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc-gutt']);
  });

  it('asks for the service alongside the write, not after it', async () => {
    let release: () => void = () => {};
    vi.mocked(cancelManage).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({});
      })
    );

    const pending = post({ action: 'cancel' });
    await vi.waitFor(() => expect(getManage).toHaveBeenCalled());
    release();
    await pending;

    expect(expireSlots).toHaveBeenCalledWith(['svc-gutt']);

    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc-gutt']);
  });

  it('still answers ok when the service cannot be looked up', async () => {
    vi.mocked(getManage).mockRejectedValue(new MedalApiError(404, 'NOT_FOUND', 'gone'));

    const response = await post({ action: 'cancel' });

    expect(response.status).toBe(200);
    expect(expireSlots).not.toHaveBeenCalled();
    expect(expireBookingSeeds).not.toHaveBeenCalled();
  });

  it('expires the service when a move lost its slot, since the cache offered it', async () => {
    vi.mocked(rescheduleManage).mockRejectedValue(
      new MedalApiError(409, 'CONFLICT', 'SLOT_TAKEN: gone')
    );

    const response = await post({ action: 'reschedule', startTs: 1_800_000_000_000 });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('slotTaken');
    expect(expireSlots).toHaveBeenCalledWith(['svc-gutt']);
    expect(expireBookingSeeds).toHaveBeenCalledWith(['svc-gutt']);
  });

  it('leaves the cache alone when the write failed', async () => {
    vi.mocked(cancelManage).mockRejectedValue(
      new MedalApiError(409, 'CONFLICT', 'CANCEL_WINDOW_PASSED')
    );

    await post({ action: 'cancel' });

    expect(expireSlots).not.toHaveBeenCalled();

    expect(expireBookingSeeds).not.toHaveBeenCalled();
  });
});
