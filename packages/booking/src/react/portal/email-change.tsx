/**
 * «E-post» on the profile: the address on file and «Endre», which opens a
 * two-step sheet — the new address, then the six-digit code Medal mailed to
 * it — and ends on «changed» (with «reconnect Vipps» when the change unlinked
 * it).
 *
 * BOTH STEPS ARE `fetch`es TO ROUTE HANDLERS (`<portalApi>/email/start` and
 * `/email/verify`), not server actions: verifying replaces the session cookie
 * (Medal revokes the one presented), and in Next 16 an action that sets a
 * cookie re-renders the page behind the sheet. After a good code the page is
 * refreshed ONCE, on «Ferdig», so the profile reads the new address and the
 * Vipps row its new state.
 *
 * A refusal (422) is a sentence beside the field it is about, never a logout:
 * only a 401 `session` sends the customer to the login. Start never says an
 * address is taken or undeliverable (it answers «sent»), so the code step
 * always says what to do when no code comes — resend after a delay, or go
 * back and fix the address — and a taken address is refused at verify, which
 * sends the customer back to the first step.
 */

import { BOOKING_INPUT_CLASS, BookingButton, OtpSlots } from '@medalsocial/meda/booking';
import { Field, Input, Sheet } from '@medalsocial/meda/primitives';
import { XIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from 'react';
import { fill, labelText } from '../../core/labels';
import type { PortalActions } from '../actions';
import type { BookingLabels } from '../labels';
import type { ResolvedBooking } from '../Provider';
import { screenLabels } from '../screen-labels';

/** How long «send a new code» waits after a code went out. */
export const EMAIL_CHANGE_RESEND_DELAY_MS = 30_000;

/** Start: `unchanged`, `too_many_codes`. Verify: `code_invalid`, `email_taken`. */
type Refusal = 'unchanged' | 'too_many_codes' | 'code_invalid' | 'email_taken';

type Failure =
  | { ok: false; reason: 'refused'; refusal: Refusal }
  | {
      ok: false;
      reason: 'invalid' | 'session' | 'throttled' | 'unavailable' | 'unreachable' | 'forbidden';
    };

type StartAnswer = { ok: true; to: string | null } | Failure;
type VerifyAnswer = { ok: true; email: string; signedIn: boolean } | Failure;

type Step =
  | { kind: 'email' }
  | { kind: 'code'; email: string; to: string | null; sentAt: number }
  | { kind: 'done'; email: string; signedIn: boolean };

/** POST `body` to `path`; a network failure or a non-JSON body is `unreachable`. */
async function post<T>(path: string, body: unknown): Promise<T | Failure> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) return parsed as T;
  } catch {
    // Falls through to «unreachable».
  }
  return { ok: false, reason: 'unreachable' };
}

/** The sentence for a failure; `invalid` is the step's own field rule. */
function failureText(labels: Readonly<BookingLabels>, failure: Failure, invalid: string): string {
  switch (failure.reason) {
    case 'refused':
      return labelText(labels[`emailChange.refused.${failure.refusal}`]);
    case 'invalid':
      return invalid;
    case 'throttled':
      return labelText(labels['emailChange.throttled']);
    case 'unavailable':
      return labelText(labels['emailChange.unavailable']);
    default:
      return labelText(labels['emailChange.unreachable']);
  }
}

/** Seconds left until `sentAt + delay`, ticking once a second while above zero. */
function useCountdown(sentAt: number | null, delay: number): number {
  const remaining = () =>
    sentAt === null ? 0 : Math.max(0, Math.ceil((sentAt + delay - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(remaining);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `remaining` reads only `sentAt` and `delay`.
  useEffect(() => {
    setSeconds(remaining());
    if (sentAt === null) return;
    const timer = setInterval(() => {
      const next = remaining();
      setSeconds(next);
      if (next === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [sentAt, delay]);
  return seconds;
}

export interface PortalEmailChangeProps {
  booking: ResolvedBooking;
  /** The address on file. */
  email: string;
  /** Whether a Vipps login is linked now — a change unlinks it, and the success says so. */
  vippsLinked?: boolean;
  /** «Reconnect Vipps» on the success, where the app can start a link. */
  startVippsLink?: PortalActions['startVippsLink'];
  /** The wait before «send a new code» is offered. Default 30 s. */
  resendDelayMs?: number;
}

export function PortalEmailChange({
  booking,
  email,
  vippsLinked = false,
  startVippsLink,
  resendDelayMs = EMAIL_CHANGE_RESEND_DELAY_MS,
}: PortalEmailChangeProps) {
  const { kit } = booking;
  const { labels } = kit;
  const api = kit.config.paths.portalApi;
  const router = useRouter();
  const id = useId();
  const ids = {
    heading: `${id}-heading`,
    email: `${id}-email`,
    code: `${id}-code`,
    error: `${id}-error`,
    status: `${id}-status`,
    done: `${id}-done`,
  };

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [vippsPending, startVipps] = useTransition();
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const seconds = useCountdown(step.kind === 'code' ? step.sentAt : null, resendDelayMs);

  // Each step lands focus where the customer goes next: the field, the code
  // (its hidden `one-time-code` input), or the outcome's heading.
  useEffect(() => {
    if (!open) return;
    const target =
      step.kind === 'done' ? doneHeading.current : document.getElementById(`${id}-${step.kind}`);
    target?.focus();
  }, [open, step, id]);

  function reset() {
    setStep({ kind: 'email' });
    setAddress('');
    setCode('');
    setError(null);
    setStatus(null);
  }

  function toLogin() {
    router.push(kit.config.paths.portalLogin);
  }

  function onOpenChange(next: boolean) {
    if (!next && step.kind === 'done') {
      // The profile on the page still shows the old address and Vipps state.
      router.refresh();
    }
    if (!next) reset();
    setOpen(next);
  }

  function sendCode(to: string, resend: boolean) {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const answer = await post<StartAnswer>(`${api}/email/start`, { email: to });
      if (answer.ok) {
        setStep({ kind: 'code', email: to, to: answer.to, sentAt: Date.now() });
        setCode('');
        if (resend) setStatus(labelText(labels['emailChange.resent']));
        return;
      }
      if (answer.reason === 'session') return toLogin();
      setError(failureText(labels, answer, labelText(labels['emailChange.invalidEmail'])));
    });
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = address.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(labelText(labels['emailChange.invalidEmail']));
      return;
    }
    sendCode(trimmed, false);
  }

  /** Only drawn on the code step. While a check runs the code is read-only and «Bekreft» disabled. */
  function verify(value: string) {
    if (!/^\d{6}$/.test(value)) {
      setError(labelText(labels['emailChange.invalidCode']));
      return;
    }
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const answer = await post<VerifyAnswer>(`${api}/email/verify`, { code: value });
      if (answer.ok) {
        setStep({ kind: 'done', email: answer.email, signedIn: answer.signedIn });
        return;
      }
      if (answer.reason === 'session') return toLogin();
      const text = failureText(labels, answer, labelText(labels['emailChange.invalidCode']));
      if (answer.reason === 'refused' && answer.refusal === 'email_taken') {
        // The code is spent and the address gone: back to the first step.
        setStep({ kind: 'email' });
      } else {
        setCode('');
      }
      setError(text);
    });
  }

  function reconnectVipps(start: NonNullable<PortalActions['startVippsLink']>) {
    startVipps(async () => {
      // On success this navigates to Vipps and never answers.
      const answer = await start(null).catch(() => ({
        ok: false as const,
        reason: 'unavailable' as const,
      }));
      if (answer?.reason === 'session') return toLogin();
      if (answer) setError(labelText(labels['emailChange.unreachable']));
    });
  }

  const errorLine = (
    <div aria-live="polite" className="min-h-5">
      {error && <Field.Error id={ids.error}>{error}</Field.Error>}
    </div>
  );

  return (
    <section aria-labelledby={ids.heading} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4">
        <div className="min-w-0">
          <h2 id={ids.heading} className="font-semibold">
            {labels['emailChange.heading']}
          </h2>
          <p className="break-all text-sm text-muted-foreground">{email}</p>
        </div>
        <Sheet open={open} onOpenChange={onOpenChange} dismissible={!pending}>
          <Sheet.Trigger
            render={
              <BookingButton
                variant="outline"
                aria-label={labelText(labels['emailChange.buttonLabel'])}
              />
            }
          >
            {labels['emailChange.button']}
          </Sheet.Trigger>
          <Sheet.Content>
            {step.kind === 'email' && (
              <form onSubmit={submitEmail} className="space-y-5" noValidate>
                <Sheet.Title className="pe-10 font-sans text-2xl font-bold">
                  {labels['emailChange.title']}
                </Sheet.Title>
                <Sheet.Description className="text-muted-foreground">
                  {labels['emailChange.lead']}
                </Sheet.Description>
                <Field>
                  <Field.Label htmlFor={ids.email}>{labels['emailChange.newEmail']}</Field.Label>
                  <Input
                    id={ids.email}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={254}
                    value={address}
                    readOnly={pending}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? ids.error : undefined}
                    onChange={(event) => setAddress(event.target.value)}
                    className={BOOKING_INPUT_CLASS}
                  />
                </Field>
                {errorLine}
                <BookingButton
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={pending}
                  aria-busy={pending || undefined}
                >
                  {labels['emailChange.send']}
                </BookingButton>
              </form>
            )}

            {step.kind === 'code' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  verify(code);
                }}
                className="space-y-5"
              >
                <Sheet.Title className="pe-10 font-sans text-2xl font-bold">
                  {labels['emailChange.codeTitle']}
                </Sheet.Title>
                <Sheet.Description className="text-muted-foreground">
                  {step.to === null
                    ? labels['emailChange.sentToUnknown']
                    : fill(labels['emailChange.sentTo'], { to: step.to })}
                </Sheet.Description>
                <Field>
                  <Field.Label htmlFor={ids.code}>{labels['otp.label']}</Field.Label>
                  <OtpSlots
                    id={ids.code}
                    value={code}
                    readOnly={pending}
                    invalid={error !== null}
                    describedBy={error ? ids.error : undefined}
                    labels={screenLabels(labels)}
                    onChange={(next) => {
                      setCode(next);
                      if (error) setError(null);
                    }}
                    onComplete={verify}
                  />
                  <Field.Description>{labels['emailChange.codeHelp']}</Field.Description>
                </Field>
                {/* Always: start says «sent» even for an address no mail could reach. */}
                <p className="text-sm text-muted-foreground">{labels['emailChange.noCode']}</p>
                {errorLine}
                <div aria-live="polite" className="sr-only" id={ids.status}>
                  {status}
                </div>
                <BookingButton
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={pending}
                  aria-busy={pending || undefined}
                >
                  {labels['emailChange.confirm']}
                </BookingButton>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <BookingButton
                    variant="link"
                    disabled={pending || seconds > 0}
                    onClick={() => sendCode(step.email, true)}
                  >
                    {seconds > 0
                      ? fill(labels['emailChange.resendIn'], { seconds })
                      : labels['emailChange.resend']}
                  </BookingButton>
                  <BookingButton
                    variant="link"
                    disabled={pending}
                    onClick={() => {
                      setAddress(step.email);
                      setCode('');
                      setError(null);
                      setStep({ kind: 'email' });
                    }}
                  >
                    {labels['emailChange.otherAddress']}
                  </BookingButton>
                </div>
              </form>
            )}

            {step.kind === 'done' && (
              <div className="space-y-5">
                <Sheet.Title
                  ref={doneHeading}
                  tabIndex={-1}
                  className="pe-10 font-sans text-2xl font-bold focus:outline-none"
                >
                  {labels['emailChange.doneTitle']}
                </Sheet.Title>
                <Sheet.Description id={ids.done}>
                  {fill(labels['emailChange.done'], { email: step.email })}
                </Sheet.Description>
                {!step.signedIn && (
                  <>
                    <p>{labels['emailChange.signedOut']}</p>
                    <BookingButton size="lg" className="w-full" onClick={toLogin}>
                      {labels['emailChange.login']}
                    </BookingButton>
                  </>
                )}
                {step.signedIn && vippsLinked && (
                  <>
                    <p className="text-muted-foreground">{labels['emailChange.vippsRelink']}</p>
                    {startVippsLink && (
                      <BookingButton
                        variant="outline"
                        size="lg"
                        className="w-full"
                        disabled={vippsPending}
                        aria-busy={vippsPending || undefined}
                        onClick={() => reconnectVipps(startVippsLink)}
                      >
                        {labels['emailChange.vippsRelinkButton']}
                      </BookingButton>
                    )}
                  </>
                )}
                {errorLine}
                {step.signedIn && (
                  <BookingButton size="lg" className="w-full" onClick={() => onOpenChange(false)}>
                    {labels['emailChange.finish']}
                  </BookingButton>
                )}
              </div>
            )}

            <Sheet.Close
              render={
                <BookingButton
                  variant="ghost"
                  className="absolute top-4 right-4"
                  size="icon-sm"
                  disabled={pending}
                />
              }
            >
              <XIcon aria-hidden="true" />
              <span className="sr-only">{labels['emailChange.close']}</span>
            </Sheet.Close>
          </Sheet.Content>
        </Sheet>
      </div>
    </section>
  );
}
