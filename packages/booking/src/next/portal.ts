/**
 * The customer portal's server half: the session cookie, the action functions
 * behind the portal's forms, and the two Vipps return routes.
 *
 * SERVER ACTIONS STAY IN THE APP. A library cannot ship `'use server'` exports
 * reliably, so these are plain async functions and the app wraps each in a
 * three-line action:
 *
 * ```ts
 * 'use server';
 * export async function updateProfileAction(input: unknown) {
 *   return booking.portal.actions.updateProfile(input);
 * }
 * ```
 *
 * The components receive the actions as props, so nothing in the package
 * imports from an app file.
 *
 * Every action keeps the same two obligations:
 *
 * - **The session never leaves the server.** It is read from the cookie
 *   inside `withPortalSession`, handed to the seam, and appears in no return
 *   value — an action's result is serialised into the browser.
 * - **A dead session is an answer, not an error.** Medal saying the cookie is
 *   no longer honoured comes back as `{ ok: false, reason: 'session' }` with
 *   the cookie already cleared.
 *
 * Inputs are validated here first, in the site's own words (`schemas` are
 * exported too, for an app that validates with its own action client). What
 * the engine still rejects comes back as `{ ok: false, reason: 'invalid',
 * message }`. Anything else is thrown, for the app's action client to turn
 * into a generic error — which is why the seam scrubs the session out of
 * every error first.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { PortalProfileDto } from '../core/portal/dto';
import { emailField, verifyLoginInput } from '../core/portal/login-input';
import { mintBrowserBinding } from '../core/portal/vipps-link';
import type { BookingGuardian } from '../core/types';
import {
  type PortalPersonResult,
  PortalSessionExpiredError,
  PortalThrottledError,
  PortalValidationError,
  PortalVippsUnavailableError,
} from './portal/medal-portal';
import { originFromHeaders } from './request';
import { vippsLinkReturnRoute, vippsReturnRoute } from './routes/vipps-return';
import type { BookingRuntime } from './runtime';

export type SessionFailure = { ok: false; reason: 'session' };
export type InvalidInput = { ok: false; reason: 'invalid'; message: string };

/** What the Vipps button hears back when it did NOT get a redirect. */
export type VippsStartState = { ok: false; reason: 'unavailable' | 'throttled' } | null;

/** What «link Vipps» hears back when it did NOT get a redirect. */
export type VippsLinkStartState = {
  ok: false;
  /** `missing`: this Medal has no link route — the row hides itself. */
  reason: 'missing' | 'session' | 'unavailable' | 'throttled';
} | null;

export type UpdateProfileResult =
  | { ok: true; profile: PortalProfileDto }
  | SessionFailure
  | InvalidInput;

export type PersonActionResult =
  | { ok: true; profile: PortalProfileDto; personId: string | null; fallback: boolean }
  | SessionFailure
  | InvalidInput;

export type VerifyLoginResult =
  | { ok: true; guardian: BookingGuardian | null }
  | { ok: false; reason: 'invalid' | 'throttled' | 'unreachable' };

function isOk(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'ok' in result && result.ok === true;
}

/** The first issue's message, for a form that has no sentence of its own. */
function invalid(error: z.ZodError): InvalidInput {
  /* v8 ignore next -- defensive: a failed parse always carries at least one issue */
  return { ok: false, reason: 'invalid', message: error.issues[0]?.message ?? 'Invalid input' };
}

/** The schemas the actions validate with, for an app's own action client. */
export function createPortalSchemas(rt: BookingRuntime) {
  const { messages, phone } = rt;
  const nameField = z.string().trim().min(1).max(60);

  /**
   * The same rule the wizard applies on the details step, normalised the same
   * way, so a parent who books with one spelling and edits with another stays
   * one contact. `''` clears.
   */
  const phoneField = z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (!phone.looksValid(trimmed)) {
      ctx.addIssue({ code: 'custom', message: messages.invalidPhone });
      return z.NEVER;
    }
    return phone.nationalDigits(trimmed);
  });

  /** Whole, plausible years. */
  const birthYearField = z
    .number()
    .int()
    .refine((year) => year >= 1900 && year <= new Date().getFullYear(), {
      message: messages.invalidBirthYear,
    });

  const personFields = z.object({
    name: nameField,
    birth_year: birthYearField,
    birth_month: z.number().int().min(1).max(12).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    preferred_resource_id: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .nullable()
      .optional(),
  });

  /** Which child: the id wherever the profile named one, else the index. */
  const personTarget = z.object({
    person_id: z.string().min(1).max(64).nullable().optional(),
    index: z.number().int().min(0).max(19).optional(),
  });

  return {
    startLogin: z.object({ email: emailField }),
    verifyLogin: verifyLoginInput,
    updateProfile: z.object({
      first_name: nameField.optional(),
      last_name: nameField.optional(),
      phone: z.union([z.null(), phoneField]).optional(),
      family: z
        .array(z.object({ name: nameField, birth_year: birthYearField }))
        .max(10)
        .optional(),
    }),
    createPerson: z.object({ person: personFields }),
    updatePerson: personTarget.extend({ person: personFields }),
    savePerson: personTarget.extend({ person: personFields, create: z.boolean() }),
    removePerson: personTarget,
    setMarketingConsent: z.object({ granted: z.boolean() }),
    deleteMe: z.object({ confirm: z.literal(rt.options.portal?.deleteConfirmWord ?? 'SLETT') }),
  };
}

export type PortalSchemas = ReturnType<typeof createPortalSchemas>;

/** An empty string is «cleared» for the optional text fields (absent is the caller's). */
function blankIsNull(value: string | null): string | null {
  return value === null || value === '' ? null : value;
}

export function createPortalActions(rt: BookingRuntime) {
  const schemas = createPortalSchemas(rt);
  const { portal, session: jar, vippsLink, nextPath } = rt;
  const configuredLocale = rt.options.portal?.locale;
  const locale = configuredLocale ?? 'no';
  const portalPath = rt.paths.portal ?? rt.config.paths.booking;

  /**
   * Run `fn` with the parent's session, or say why not. No cookie and a
   * cookie Medal refuses are one answer, and both clear the cookie. When `fn`
   * comes back `{ ok: true }`, Medal has just slid the session and the cookie
   * is renewed to match — never for a delete (which clears it) or an export.
   */
  async function withPortalSession<T>(
    fn: (session: string) => Promise<T>,
    { renew = true }: { renew?: boolean } = {}
  ): Promise<T | SessionFailure> {
    const session = await jar.readPortalSession();
    if (session === null) {
      await jar.clearPortalSession();
      return { ok: false, reason: 'session' };
    }
    try {
      const result = await fn(session);
      if (renew && isOk(result)) await jar.renewPortalSession(session);
      return result;
    } catch (error) {
      if (error instanceof PortalSessionExpiredError) {
        await jar.clearPortalSession();
        return { ok: false, reason: 'session' };
      }
      throw error;
    }
  }

  /** The origin this request arrived on, for an absolute return URL. */
  async function requestOrigin(): Promise<string> {
    return originFromHeaders(await headers(), rt.baseUrl() ?? '');
  }

  function personAnswer(result: PortalPersonResult): PersonActionResult {
    revalidatePath(portalPath);
    return {
      ok: true as const,
      profile: result.profile,
      personId: result.personId,
      fallback: result.fallback,
    };
  }

  async function asPersonAction(
    run: (session: string) => Promise<PortalPersonResult>
  ): Promise<PersonActionResult> {
    return withPortalSession(async (session) => {
      try {
        return personAnswer(await run(session));
      } catch (error) {
        if (error instanceof PortalValidationError) {
          return { ok: false as const, reason: 'invalid' as const, message: error.message };
        }
        throw error;
      }
    });
  }

  function personInput(person: z.infer<PortalSchemas['createPerson']>['person']) {
    return {
      name: person.name,
      birthYear: person.birth_year,
      ...(person.birth_month === undefined ? {} : { birthMonth: person.birth_month }),
      ...(person.notes === undefined ? {} : { notes: blankIsNull(person.notes) }),
      ...(person.preferred_resource_id === undefined
        ? {}
        : { preferredResourceId: blankIsNull(person.preferred_resource_id) }),
    };
  }

  return {
    /**
     * Ask for a code. Always «sent» — including when Medal is throttling this
     * address: a different answer would let anyone confirm which parents are
     * customers by asking a few times.
     */
    async startLogin(input: unknown): Promise<{ status: 'sent' } | InvalidInput> {
      const parsed = schemas.startLogin.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      try {
        // The seam's own default when the site names no locale, as before the move.
        await (configuredLocale === undefined
          ? portal.startLogin(parsed.data.email)
          : portal.startLogin(parsed.data.email, configuredLocale));
      } catch (error) {
        if (!(error instanceof PortalThrottledError)) throw error;
      }
      return { status: 'sent' as const };
    },

    /**
     * Exchange the code for the cookie. Prefer the `login/verify` ROUTE from
     * the browser: an action that sets a cookie makes Next re-render the page
     * it was called from. This is for a page that wants that.
     */
    async verifyLogin(input: unknown): Promise<VerifyLoginResult> {
      const parsed = schemas.verifyLogin.safeParse(input);
      if (!parsed.success) return { ok: false, reason: 'invalid' };
      let issued: Awaited<ReturnType<typeof portal.verifyLogin>>;
      try {
        issued = await portal.verifyLogin(parsed.data.email, parsed.data.code);
      } catch (error) {
        if (error instanceof PortalThrottledError) return { ok: false, reason: 'throttled' };
        rt.logger.error(error, 'Portal login code could not be verified');
        return { ok: false, reason: 'unreachable' };
      }
      if (issued === null) return { ok: false, reason: 'invalid' };
      await jar.writePortalSession(issued.sessionToken, issued.expiresAt);
      return { ok: true, guardian: await rt.guardianFromSession(issued.sessionToken) };
    },

    /**
     * Send the parent to Vipps — the `action` of a `<form>` driven by
     * `useActionState`, so `(previous, formData)` and the answer IS the next
     * state; the success path never returns (`redirect()` throws, outside
     * the `try`).
     *
     * The return URL is the Vipps return route on the origin the request
     * arrived on (the canonical `baseUrl` when it names none): a preview host
     * must not send its parents back to production. `next` is where a login
     * that did not start on the portal should land; it is validated and kept
     * in a cookie, written on EVERY attempt (`null` included) so a leftover
     * destination cannot capture an ordinary login.
     */
    async startVipps(_previous: VippsStartState, formData?: FormData): Promise<VippsStartState> {
      const next = formData?.get('next');
      await nextPath.writePortalNextPath(typeof next === 'string' ? next : null);
      const returnUrl = new URL(rt.paths.vippsReturn, await requestOrigin()).toString();
      // This browser's binding for a pending link Medal may offer — minted per
      // attempt, kept in an httpOnly cookie, never in a URL.
      const browserBinding = mintBrowserBinding();
      await vippsLink.writeBrowserBinding(browserBinding);
      let authorizeUrl: string;
      try {
        ({ authorizeUrl } = await portal.startVippsLogin({ returnUrl, browserBinding, locale }));
      } catch (error) {
        // No login went out, so no callback will ever spend this binding.
        await vippsLink.clearBrowserBinding();
        if (error instanceof PortalThrottledError) return { ok: false, reason: 'throttled' };
        if (!(error instanceof PortalVippsUnavailableError)) {
          rt.logger.error(error, 'Vipps login could not be started');
        }
        return { ok: false, reason: 'unavailable' };
      }
      redirect(authorizeUrl);
    },

    /**
     * «Link Vipps» on the profile: send a LOGGED-IN parent to Vipps to link it
     * to the profile they are in. The same shape as `startVipps`, with the
     * session as the difference. A Medal without the route is `missing`.
     */
    async startVippsLink(
      _previous: VippsLinkStartState,
      _formData?: FormData
    ): Promise<VippsLinkStartState> {
      const session = await jar.readPortalSession();
      if (session === null) return { ok: false, reason: 'session' };
      const returnUrl = new URL(rt.paths.vippsLinkReturn, await requestOrigin()).toString();
      const browserBinding = mintBrowserBinding();
      await vippsLink.writeBrowserBinding(browserBinding);
      let authorizeUrl: string;
      try {
        const started = await portal.startVippsLink(session, {
          returnUrl,
          browserBinding,
          locale,
        });
        if (started === null) {
          await vippsLink.clearBrowserBinding();
          return { ok: false, reason: 'missing' };
        }
        authorizeUrl = started.authorizeUrl;
      } catch (error) {
        await vippsLink.clearBrowserBinding();
        if (error instanceof PortalSessionExpiredError) {
          await jar.clearPortalSession();
          return { ok: false, reason: 'session' };
        }
        if (error instanceof PortalThrottledError) return { ok: false, reason: 'throttled' };
        if (!(error instanceof PortalVippsUnavailableError)) {
          rt.logger.error(error, 'Vipps link could not be started');
        }
        return { ok: false, reason: 'unavailable' };
      }
      redirect(authorizeUrl);
    },

    /**
     * Log out. The cookie is cleared whatever Medal says, but only AFTER the
     * revocation is attempted. A revocation that fails is swallowed, and not
     * logged: the only thing worth saying about it would name the session.
     */
    async logout(): Promise<{ ok: true }> {
      const session = await jar.readPortalSession();
      if (session !== null) {
        try {
          await portal.logout(session);
        } catch {
          // Swallowed on purpose; see above.
        }
      }
      await jar.clearPortalSession();
      return { ok: true as const };
    },

    /**
     * Edit name, phone and children. The patch carries only the keys the
     * parent sent. Every successful write revalidates the portal page, so Back
     * does not show the values from before the save.
     */
    async updateProfile(input: unknown): Promise<UpdateProfileResult> {
      const parsed = schemas.updateProfile.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      return withPortalSession(async (session) => {
        try {
          const profile = await portal.updateMe(session, parsed.data);
          revalidatePath(portalPath);
          return { ok: true as const, profile };
        } catch (error) {
          if (error instanceof PortalValidationError) {
            return { ok: false as const, reason: 'invalid' as const, message: error.message };
          }
          throw error;
        }
      });
    },

    /** Add one child (the person endpoints, else the whole-list fallback). */
    async createPerson(input: unknown): Promise<PersonActionResult> {
      const parsed = schemas.createPerson.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      const person = personInput(parsed.data.person);
      return asPersonAction((session) => portal.createPerson(session, person));
    },

    /** Edit one child in place — the id survives a rename. */
    async updatePerson(input: unknown): Promise<PersonActionResult> {
      const parsed = schemas.updatePerson.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      const person = personInput(parsed.data.person);
      const target = { personId: parsed.data.person_id, index: parsed.data.index };
      return asPersonAction((session) => portal.updatePerson(session, target, person));
    },

    /** `createPerson` or `updatePerson`, by the `create` flag — one form, one action. */
    async savePerson(input: unknown): Promise<PersonActionResult> {
      const parsed = schemas.savePerson.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      const person = personInput(parsed.data.person);
      return asPersonAction((session) =>
        parsed.data.create
          ? portal.createPerson(session, person)
          : portal.updatePerson(
              session,
              { personId: parsed.data.person_id, index: parsed.data.index },
              person
            )
      );
    },

    /** Remove one child. Medal deactivates the person; its booking history stays. */
    async removePerson(input: unknown): Promise<PersonActionResult> {
      const parsed = schemas.removePerson.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      const target = { personId: parsed.data.person_id, index: parsed.data.index };
      return asPersonAction((session) => portal.removePerson(session, target));
    },

    /**
     * The marketing box on the profile, through the same profile patch, and
     * echoing the STORED value so the checkbox shows what Medal has.
     */
    async setMarketingConsent(
      input: unknown
    ): Promise<{ ok: true; marketingConsent: boolean } | SessionFailure | InvalidInput> {
      const parsed = schemas.setMarketingConsent.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      return withPortalSession(async (session) => {
        const profile = await portal.updateMe(session, {
          marketing_consent: parsed.data.granted,
        });
        revalidatePath(portalPath);
        return { ok: true as const, marketingConsent: profile.marketingConsent };
      });
    },

    /**
     * The parent's data as a file (GDPR art. 15), pretty-printed and dated.
     * No renewal: a cookie set by an action re-renders the page, which would
     * hold the download behind a full dashboard render.
     */
    async exportData(): Promise<{ ok: true; filename: string; json: string } | SessionFailure> {
      return withPortalSession(
        async (session) => {
          const exported = await portal.exportMyData(session);
          const date = new Date().toISOString().slice(0, 10);
          return {
            ok: true as const,
            filename: `${rt.options.portal?.exportFilePrefix ?? 'min-side-eksport'}-${date}.json`,
            json: JSON.stringify(exported, null, 2),
          };
        },
        { renew: false }
      );
    },

    /**
     * Delete the account (GDPR art. 17). The confirmation word is checked
     * here rather than trusted from a disabled button. The cookie is cleared
     * only after Medal has said yes.
     */
    async deleteMe(input: unknown): Promise<{ ok: true } | SessionFailure | InvalidInput> {
      const parsed = schemas.deleteMe.safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      return withPortalSession(
        async (session) => {
          await portal.deleteMe(session);
          await jar.clearPortalSession();
          return { ok: true as const };
        },
        { renew: false }
      );
    },
  };
}

export type PortalActions = ReturnType<typeof createPortalActions>;

export interface Portal {
  /** The session cookie, for a page or route of the app's own. */
  session: BookingRuntime['session'];
  actions: PortalActions;
  schemas: PortalSchemas;
  /** `GET` for the Vipps login return route (`portal.vippsReturnPath`). */
  vippsReturn: { GET(request: Request): Promise<Response> };
  /** `GET` for the «link Vipps» return route (`portal.vippsLinkReturnPath`). */
  vippsLinkReturn: { GET(request: Request): Promise<Response> };
}

export function createPortalFor(rt: BookingRuntime): Portal {
  return {
    session: rt.session,
    actions: createPortalActions(rt),
    schemas: createPortalSchemas(rt),
    vippsReturn: { GET: (request) => vippsReturnRoute(rt, request) },
    vippsLinkReturn: { GET: (request) => vippsLinkReturnRoute(rt, request) },
  };
}
