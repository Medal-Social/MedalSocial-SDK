import { z } from 'zod';

/**
 * The login's two inputs, validated the same way wherever they arrive — the
 * `startLoginAction` server action and `POST /api/portal/login/verify`.
 *
 * A module of its own because a `'use server'` file may export only async
 * functions, and the route handler needs the same schema the action uses: two
 * spellings of «what is an e-mail address» would let an address a code was
 * sent to be refused when the code comes back.
 */

/**
 * Trimmed and lowercased BEFORE the format check, and piped rather than
 * chained: `z.email()` validates the raw value, so a pasted address with a
 * trailing space would be refused for a reason the parent cannot see.
 * Lowercased because the code is looked up by address and «Kari@» and «kari@»
 * are one inbox.
 */
export const emailField = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Six digits, nothing else — Medal's own code shape. */
export const codeField = z.string().regex(/^\d{6}$/, 'Koden er seks siffer.');

export const verifyLoginInput = z.object({ email: emailField, code: codeField });

/** Why a code did not end in a session, in the words the login form keys its copy on. */
export type VerifyLoginFailure = 'invalid' | 'throttled' | 'unreachable';
