import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one login, in both the places it is taken.
 *
 * - As a SHEET from the booking wizard, where a login is an offer and never a
 *   gate: an accessible dialog that hands the parent back to the wizard with
 *   who they are, and never navigates, because the half-built booking is a
 *   `useReducer` behind it.
 * - INLINE on `/min-side/logg-inn`, where the login is the whole page and ends
 *   in exactly one navigation.
 *
 * The code field is the same in both, and it is where most of these tests
 * live: a paste fills it, the sixth digit sends it, a wrong code empties it,
 * and «Send ny kode» waits thirty seconds between codes.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const actions = vi.hoisted(() => ({
  startLoginAction: vi.fn(),
  startVippsLoginAction: vi.fn(),
}));

/**
 * `POST /api/portal/login/verify`, which is where the code is checked — a
 * route handler and deliberately not a server action, because an action that
 * sets a cookie makes Next re-fetch the page it was called from. Each call's
 * JSON body goes to `verify`, and what `verify` returns is the answer.
 */
const verify =
  vi.fn<(body: { email: string; code: string }) => { status: number; body: unknown }>();
const OK = (guardian: BookingGuardian | null) => ({ status: 200, body: { ok: true, guardian } });
const REFUSED = (reason: 'invalid' | 'throttled') => ({
  status: reason === 'invalid' ? 401 : 429,
  body: { ok: false, reason },
});
const fetchCalls: string[] = [];
/** What `POST /api/portal/vipps/link/verify` answers — SP10's confirm code. */
const vippsVerify = vi.fn<(body: { code: string }) => { status: number; body: unknown }>(() => ({
  status: 401,
  body: { ok: false, reason: 'invalid' },
}));

import type { ComponentProps } from 'react';
import type { BookingGuardian } from '../../../src/core/types';
import { LoginSheet as Login, type LoginSheetProps } from '../../../src/react/LoginSheet';
import { BookingProvider } from '../../../src/react/Provider';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

/**
 * The source mocked the app's actions module; the package takes the actions
 * as a prop, so this renders the login with the same two mocks passed in,
 * under the parity config and the test label pack.
 */
type WithoutActions<T> = T extends unknown ? Omit<T, 'actions'> : never;
function LoginSheet(props: WithoutActions<LoginSheetProps>) {
  return (
    <BookingProvider config={PARITY_CONFIG} labels={TEST_LABELS}>
      <Login
        {...(props as ComponentProps<typeof Login>)}
        actions={{
          startLogin: actions.startLoginAction,
          startVipps: actions.startVippsLoginAction,
        }}
      />
    </BookingProvider>
  );
}

const EMAIL = 'kari@example.com';

const KARI: BookingGuardian = {
  firstName: 'Kari',
  lastName: 'Nordmann',
  email: EMAIL,
  phone: '40000000',
  family: [{ name: 'Jonas', birthYear: 2018 }],
};

const INVALID = 'Feil kode, eller koden har gått ut. Prøv igjen eller be om en ny.';

function renderSheet(onSignedIn = vi.fn()) {
  render(
    <div>
      <button type="button">Før</button>
      <LoginSheet presentation="sheet" resumePath="/bestill?resume=1" onSignedIn={onSignedIn} />
    </div>
  );
  return { onSignedIn };
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Logg inn' }));
  const dialog = await screen.findByRole('dialog', { name: 'Logg inn' });
  // Base UI moves initial focus on the next animation frame. Under load a test
  // could otherwise paste and close before focus ever left the trigger, and a
  // focus assertion would be about a sheet that never had it.
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  return dialog;
}

/** From the e-mail field to the code field, the way a parent gets there. */
async function requestCode(typed = `  ${EMAIL}  `) {
  fireEvent.change(screen.getByLabelText('E-post'), { target: { value: typed } });
  fireEvent.click(screen.getByRole('button', { name: 'Send kode' }));
  await waitFor(() => expect(actions.startLoginAction).toHaveBeenCalled());
  return screen.findByLabelText('Engangskode');
}

function paste(input: HTMLElement, text: string) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls.length = 0;
  actions.startLoginAction.mockResolvedValue({ data: { status: 'sent' } });
  actions.startVippsLoginAction.mockResolvedValue(null);
  verify.mockReturnValue(REFUSED('invalid'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url === '/api/portal/vipps/link/verify' && init?.method === 'POST') {
        const answer = vippsVerify(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      }
      if (url !== '/api/portal/login/verify' || init?.method !== 'POST') {
        throw new Error(`unexpected fetch: ${url}`);
      }
      const answer = verify(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LoginSheet as a sheet', () => {
  it('is a row that says what it offers, and nothing else until it is opened', () => {
    renderSheet();

    expect(screen.getByText(/Har du konto\?/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logg inn' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal dialog labelled by its heading', async () => {
    const user = userEvent.setup();
    renderSheet();

    const dialog = await openSheet(user);

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Logg inn' })).toBeInTheDocument();
    // Focus is moved into it, not left on the page behind.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('closes on Escape and gives focus back to the row that opened it', async () => {
    const user = userEvent.setup();
    renderSheet();
    const trigger = screen.getByRole('button', { name: 'Logg inn' });
    await openSheet(user);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes from its own close button', async () => {
    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);

    await user.click(screen.getByRole('button', { name: 'Lukk' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // «keeps Tab inside the dialog» and «locks the page behind it from
  // scrolling» are meda's now: the sheet is meda's native modal `<dialog>`,
  // whose focus containment jsdom does not implement, and whose scroll lock
  // meda's own `login-sheet.test.tsx` pins (`overflow`, not `overflowY`).

  /**
   * Vipps is a whole navigation away and back. The destination travels as the
   * form field the portal's start action validates, and `?resume=1` is what
   * authorises the wizard's one read of the stored draft on the far end.
   */
  it('offers Vipps, and tells it to come back to the wizard', async () => {
    const user = userEvent.setup();
    renderSheet();
    const dialog = await openSheet(user);

    expect(within(dialog).getByRole('button', { name: 'Fortsett med Vipps' })).toBeInTheDocument();
    expect(dialog.querySelector('input[name="next"]')).toHaveValue('/bestill?resume=1');
  });

  it('hands the guardian back and closes — without navigating or refreshing', async () => {
    verify.mockReturnValue(OK(KARI));
    const user = userEvent.setup();
    const { onSignedIn } = renderSheet();
    await openSheet(user);

    const code = await requestCode();
    expect(actions.startLoginAction).toHaveBeenCalledWith({ email: EMAIL });
    expect(screen.getByRole('heading', { name: 'Sjekk e-posten din' })).toBeInTheDocument();
    paste(code, '492155');

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(KARI));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('LoginSheet as a sheet, closed and reopened', () => {
  /**
   * A parent who closes the sheet to go and look in their mail comes back to
   * the code screen for the address the code went to — and the wait before
   * another code is still running, or closing and reopening would be a way
   * round it.
   */
  it('resumes on the code screen with the same address and the wait still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSheet();
    await openSheet(user);
    await requestCode();
    await screen.findByRole('button', { name: /Send ny kode om 0:30/ });

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    await user.click(screen.getByRole('button', { name: 'Logg inn' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sjekk e-posten din' });
    expect(within(dialog).getByLabelText('Engangskode')).toBeInTheDocument();
    expect(within(dialog).getByText(/Seks siffer – til kari@example.com/)).toBeInTheDocument();
    const resend = within(dialog).getByRole('button', { name: /Send ny kode om 0:(19|20)/ });
    expect(resend).toBeDisabled();
    expect(actions.startLoginAction).toHaveBeenCalledTimes(1);
  });

  /**
   * After a good code the wizard replaces the row, so the trigger Base UI
   * would hand focus back to is on its way out; the wizard focuses the step
   * heading itself, and the sheet must not pull focus back to the trigger.
   */
  it('does not hand focus back to the trigger after a sign-in', async () => {
    verify.mockReturnValue(OK(KARI));
    const user = userEvent.setup();
    renderSheet();
    const trigger = screen.getByRole('button', { name: 'Logg inn' });
    await openSheet(user);

    paste(await requestCode(), '492155');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // One macrotask for Base UI's close-time focus return to run, if it would.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(trigger).not.toHaveFocus();
  });
});

describe('the live regions', () => {
  it('are mounted before the code is sent and keep their place on the code screen', async () => {
    render(<LoginSheet presentation="inline" returnPath={null} />);
    const regions = [...document.querySelectorAll('[aria-live="polite"]')];
    expect(regions.length).toBeGreaterThanOrEqual(2);

    await requestCode();
    const sent = await screen.findByText(/har du fått en kode/);
    const countdown = screen.getByText('Du kan be om en ny kode om 30 sekunder.');

    // The same nodes that were listening before, now speaking — not new ones
    // that arrived already holding the sentence.
    expect(regions.some((region) => region.contains(sent))).toBe(true);
    expect(regions).toContain(countdown);
  });
});

describe('LoginSheet inline, on Min side', () => {
  it('puts Vipps above the e-mail form, with an «eller» between', () => {
    const { container } = render(<LoginSheet presentation="inline" returnPath={null} />);

    const html = container.innerHTML;
    expect(screen.getByRole('button', { name: 'Logg inn med Vipps' })).toBeInTheDocument();
    expect(html.indexOf('Logg inn med Vipps')).toBeLessThan(html.indexOf('eller'));
    expect(html.indexOf('eller')).toBeLessThan(
      html.indexOf('Logg inn med e-postadressen du brukte da du bestilte.')
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hands the return path to Vipps', () => {
    const { container } = render(
      <LoginSheet presentation="inline" returnPath="/barnehage/lille-eik?fortsett=1" />
    );

    expect(container.querySelector('input[name="next"]')).toHaveValue(
      '/barnehage/lille-eik?fortsett=1'
    );
  });

  it('opens on the e-mail field', () => {
    render(<LoginSheet presentation="inline" returnPath={null} />);

    const input = screen.getByLabelText('E-post');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(input).toBeRequired();
    expect(screen.queryByLabelText('Engangskode')).toBeNull();
  });

  /**
   * ONE navigation. `router.replace` rather than `push` — the login page is not
   * somewhere Back should return to — and no `refresh()` after it: the server
   * action set a cookie, which already invalidates the client router cache, so
   * the destination renders fresh on the server from the cookie it now holds.
   */
  it('goes to /min-side with one replace and no refresh', async () => {
    verify.mockReturnValue(OK(KARI));
    render(<LoginSheet presentation="inline" returnPath={null} />);

    const code = await requestCode();
    paste(code, '654321');

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/min-side'));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    // The code went to the route handler, once — not through a server action,
    // whose cookie write would have re-rendered this page behind the replace.
    expect(fetchCalls).toEqual(['/api/portal/login/verify']);
    expect(verify).toHaveBeenCalledWith({ email: EMAIL, code: '654321' });
  });

  it('says it could not reach the booking system when the route fails outright', async () => {
    verify.mockReturnValue({ status: 503, body: { ok: false, reason: 'unreachable' } });
    render(<LoginSheet presentation="inline" returnPath={null} />);

    paste(await requestCode(), '654321');

    expect(
      await screen.findByText(
        'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.'
      )
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('goes back to the page that sent the parent here', async () => {
    verify.mockReturnValue(OK(null));
    render(<LoginSheet presentation="inline" returnPath="/barnehage/lille-eik?fortsett=1" />);

    paste(await requestCode(), '654321');

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/barnehage/lille-eik?fortsett=1')
    );
  });

  it('stays on the e-mail step with a plain notice when the action itself failed', async () => {
    actions.startLoginAction.mockResolvedValue({ serverError: 'Something went wrong' });
    render(<LoginSheet presentation="inline" returnPath={null} />);

    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: 'Send kode' }));

    expect(
      await screen.findByText(
        'Vi fikk ikke kontakt med bookingsystemet. Prøv igjen om et øyeblikk.'
      )
    ).toBeInTheDocument();
    // A broken deployment must not pretend a code was sent.
    expect(screen.getByLabelText('E-post')).toBeInTheDocument();
    expect(screen.queryByLabelText('Engangskode')).toBeNull();
  });

  it('asks again for a valid address when the action refuses the one typed', async () => {
    actions.startLoginAction.mockResolvedValue({ validationErrors: { email: ['bad'] } });
    render(<LoginSheet presentation="inline" returnPath={null} />);

    // Well-formed to the browser, refused by the action's own `z.email()`.
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'kari@localhost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send kode' }));

    expect(await screen.findByText('Skriv inn en gyldig e-postadresse.')).toBeInTheDocument();
  });

  it('goes back to the e-mail step from «Bruk en annen e-post»', async () => {
    render(<LoginSheet presentation="inline" returnPath={null} />);
    await requestCode();

    const other = screen.getByRole('button', { name: 'Bruk en annen e-post' });
    await waitFor(() => expect(other).toBeEnabled());
    fireEvent.click(other);

    expect(screen.getByLabelText('E-post')).toHaveValue(EMAIL);
    expect(screen.queryByLabelText('Engangskode')).toBeNull();
  });
});

describe('the code field', () => {
  it('is a numeric one-time-code field the phone can fill', async () => {
    render(<LoginSheet presentation="inline" returnPath={null} />);

    const code = await requestCode();

    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('pattern', '\\d*');
    expect(code).toHaveAttribute('maxlength', '6');
    expect(document.querySelectorAll('[data-slot=otp-slot]')).toHaveLength(6);
    expect(
      screen.getByText(
        'Hvis vi har e-postadressen din, har du fått en kode. Sjekk innboksen – og søppelposten.'
      )
    ).toBeInTheDocument();
  });

  it('fills every box from one paste and sends the code by itself', async () => {
    verify.mockReturnValue(REFUSED('invalid'));
    render(<LoginSheet presentation="inline" returnPath={null} />);
    const code = await requestCode();

    paste(code, '492 155');

    const slots = [...document.querySelectorAll('[data-slot=otp-slot]')].map(
      (slot) => slot.textContent
    );
    expect(slots).toEqual(['4', '9', '2', '1', '5', '5']);
    await waitFor(() => expect(verify).toHaveBeenCalledWith({ email: EMAIL, code: '492155' }));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('sends the code when the sixth digit is typed', async () => {
    verify.mockReturnValue(REFUSED('invalid'));
    render(<LoginSheet presentation="inline" returnPath={null} />);
    const code = await requestCode();

    fireEvent.change(code, { target: { value: '49215' } });
    expect(verify).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '492155' } });

    await waitFor(() => expect(verify).toHaveBeenCalledWith({ email: EMAIL, code: '492155' }));
  });

  it('empties itself on a wrong code, says why, and takes the caret back', async () => {
    verify.mockReturnValue(REFUSED('invalid'));
    render(<LoginSheet presentation="inline" returnPath={null} />);
    const code = await requestCode();

    paste(code, '000000');

    const error = await screen.findByText(INVALID);
    await waitFor(() => expect(code).toHaveValue(''));
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code.getAttribute('aria-describedby')).toContain(error.id);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says so when the address is being rate-limited on verify', async () => {
    verify.mockReturnValue(REFUSED('throttled'));
    render(<LoginSheet presentation="inline" returnPath={null} />);

    paste(await requestCode(), '123456');

    expect(
      await screen.findByText('For mange forsøk. Vent litt før du prøver igjen.')
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('can still be sent with the button', async () => {
    verify.mockReturnValue(REFUSED('invalid'));
    render(<LoginSheet presentation="inline" returnPath={null} />);
    const code = await requestCode();

    // Five digits never send themselves; the button is there for the parent
    // who types slowly and wants to press something.
    fireEvent.change(code, { target: { value: '12345' } });
    fireEvent.submit(code.closest('form') as HTMLFormElement);

    await waitFor(() => expect(verify).toHaveBeenCalledWith({ email: EMAIL, code: '12345' }));
  });
});

/**
 * Medal allows five codes per address per ten minutes, and asking again while
 * one is still valid sends the SAME code — so a «Send ny kode» that fires on
 * every impatient tap spends the parent's allowance on nothing. Thirty seconds
 * between asks, counted down where the button is.
 */
describe('«Send ny kode»', () => {
  it('waits thirty seconds, counting down, then resends to the same address', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<LoginSheet presentation="inline" returnPath={null} />);
    await requestCode();

    const resend = await screen.findByRole('button', { name: /Send ny kode om 0:30/ });
    expect(resend).toBeDisabled();
    // Said once, politely, not every second.
    expect(screen.getByText('Du kan be om en ny kode om 30 sekunder.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole('button', { name: /Send ny kode om 0:20/ })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    const ready = await screen.findByRole('button', { name: 'Send ny kode' });
    expect(ready).toBeEnabled();
    expect(screen.getByText('Du kan be om en ny kode nå.')).toBeInTheDocument();

    actions.startLoginAction.mockClear();
    fireEvent.click(ready);

    await waitFor(() => expect(actions.startLoginAction).toHaveBeenCalledWith({ email: EMAIL }));
    expect(
      await screen.findByText(
        'Hvis vi har e-postadressen din, har vi sendt en ny kode. Sjekk innboksen – og søppelposten.'
      )
    ).toBeInTheDocument();
    // And the wait starts again.
    expect(await screen.findByRole('button', { name: /Send ny kode om 0:30/ })).toBeDisabled();
  });
});

/**
 * SP10: Medal could not match a Vipps login to one profile and e-mailed the
 * address on file a code. The login opens on that code, verifies it against
 * its own route with the code alone, and offers the e-mail login instead.
 */
describe('LoginSheet confirming a Vipps login with a code', () => {
  it('opens by itself on the code, says where it went, and logs in with the code alone', async () => {
    const onSignedIn = vi.fn();
    vippsVerify.mockReturnValueOnce({ status: 200, body: { ok: true, guardian: KARI } });
    render(
      <LoginSheet
        presentation="sheet"
        trigger={false}
        resumePath="/bestill?resume=1"
        vippsConfirm={{ to: 'k•••@g•••.com' }}
        onSignedIn={onSignedIn}
      />
    );

    const dialog = await screen.findByRole('dialog', { name: 'Sjekk e-posten din' });
    // No row of its own: it opened for Vipps.
    expect(screen.queryByText(/Har du konto\?/)).toBeNull();
    expect(within(dialog).getByText('Vi sendte en kode til k•••@g•••.com.')).toBeInTheDocument();
    // Nothing to resend: the code went where Medal chose.
    expect(within(dialog).queryByRole('button', { name: /Send ny kode/ })).toBeNull();

    paste(within(dialog).getByLabelText('Engangskode'), '492155');

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(KARI));
    expect(vippsVerify).toHaveBeenCalledWith({ code: '492155' });
    expect(fetchCalls).toEqual(['/api/portal/vipps/link/verify']);
  });

  it('says the generic sentence when Medal named no address', async () => {
    render(<LoginSheet presentation="inline" vippsConfirm={{ to: null }} />);

    expect(
      await screen.findByText('Vi har sendt en kode til e-postadressen salongen har på deg.')
    ).toBeInTheDocument();
  });

  it('says a wrong code is wrong, and a taken Vipps account is taken', async () => {
    render(<LoginSheet presentation="inline" vippsConfirm={{ to: null }} />);
    const input = await screen.findByLabelText('Engangskode');

    paste(input, '000000');
    expect(await screen.findByText('Koden stemmer ikke eller har gått ut.')).toBeInTheDocument();

    vippsVerify.mockReturnValueOnce({ status: 409, body: { ok: false, reason: 'conflict' } });
    paste(screen.getByLabelText('Engangskode'), '492155');
    expect(
      await screen.findByText(
        'Denne Vipps-kontoen er allerede koblet til en annen profil. Logg inn med e-post, eller ring salongen.'
      )
    ).toBeInTheDocument();
  });

  it('goes to the ordinary e-mail login on «Logg inn med e-post i stedet»', async () => {
    render(<LoginSheet presentation="inline" vippsConfirm={{ to: 'k•••@g•••.com' }} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Logg inn med e-post i stedet' }));

    expect(await screen.findByLabelText('E-post')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send kode' })).toBeInTheDocument();
  });
});
