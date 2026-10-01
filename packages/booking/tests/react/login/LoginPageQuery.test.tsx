import { render as renderInDom, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The login page's query string, read in the browser so the page can be
 * prerendered. `?vipps=` is a key into a table or nothing; `?return=` is what
 * `safeReturnPath` says it is and is only ever handed to the login.
 */

const nav = vi.hoisted(() => ({ search: '' as string | null }));
const loginSheet = vi.hoisted(() => ({ props: vi.fn(), wiring: vi.fn() }));

vi.mock('next/navigation', () => ({
  // `null` is a router with no search params (outside the App Router).
  useSearchParams: () => (nav.search === null ? null : new URLSearchParams(nav.search)),
}));
// The wiring the package adds (the app's actions, the overrides) is recorded
// apart, so the source's assertions on what the login is told stay exact.
vi.mock('../../../src/react/LoginSheet', () => ({
  LoginSheet: ({
    actions,
    config,
    labels,
    classNames,
    components,
    ...props
  }: Record<string, unknown>) => {
    loginSheet.wiring({ actions, config, labels, classNames, components });
    loginSheet.props(props);
    return null;
  },
}));

import {
  LoginFromQuery as FromQuery,
  vippsNotice as noticeFor,
  returnPathFromSearch as returnPathFor,
  VippsNotice,
} from '../../../src/react/LoginPageQuery';
import { mergeLabels } from '../../../src/react/labels';
import { BookingProvider } from '../../../src/react/Provider';
import { TEST_LABELS } from '../../support/labels';
import { PARITY_CONFIG } from '../../support/parity-config';

const ACTIONS = { startLogin: vi.fn(), startVipps: vi.fn() };
const LABELS = mergeLabels(PARITY_CONFIG.locale, TEST_LABELS);

function Parity({ children }: { children: ReactNode }) {
  return (
    <BookingProvider config={PARITY_CONFIG} labels={TEST_LABELS}>
      {children}
    </BookingProvider>
  );
}
const render = (ui: ReactElement) => renderInDom(ui, { wrapper: Parity });
const LoginFromQuery = () => <FromQuery actions={ACTIONS} />;
const returnPathFromSearch = (search: string) => returnPathFor(search, PARITY_CONFIG);
const vippsNotice = (values: readonly string[]) => noticeFor(values, LABELS);

const NEEDS_EMAIL =
  'Vi fant flere profiler på deg. Logg inn med e-post denne gangen, så kobler vi Vipps etterpå.';
const FAILED = 'Vipps-innloggingen ble avbrutt. Prøv igjen, eller logg inn med e-post.';

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = '';
  window.history.replaceState(null, '', '/min-side/logg-inn');
});

describe('VippsNotice', () => {
  it('says nothing when nothing sent the parent here', () => {
    const { container } = render(<VippsNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains «needs_email_login»', () => {
    nav.search = 'vipps=needs_email_login';
    render(<VippsNotice />);
    expect(screen.getByRole('status')).toHaveTextContent(NEEDS_EMAIL);
  });

  it('explains «failed»', () => {
    nav.search = 'vipps=failed';
    render(<VippsNotice />);
    expect(screen.getByRole('status')).toHaveTextContent(FAILED);
  });

  it.each([
    'vipps=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    'vipps=cancelled',
    'vipps=constructor',
    'vipps=toString',
    'vipps=failed&vipps=failed',
  ])('renders nothing — and never the value — for ?%s', (search) => {
    nav.search = search;
    const { container } = render(<VippsNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing where the router has no search params', () => {
    nav.search = null;
    const { container } = render(<VippsNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a pure table lookup', () => {
    expect(vippsNotice(['failed'])).toBe(FAILED);
    expect(vippsNotice([])).toBeNull();
    expect(vippsNotice(['__proto__'])).toBeNull();
  });
});

describe('LoginFromQuery', () => {
  const FLOW = '/barnehage/lille-eik?fortsett=1';

  it('draws the inline login with no return path by default', () => {
    render(<LoginFromQuery />);
    expect(loginSheet.props).toHaveBeenLastCalledWith({
      presentation: 'inline',
      returnPath: null,
      vippsConfirm: null,
    });
  });

  it('hands a validated ?return= to the login', () => {
    window.history.replaceState(null, '', `/min-side/logg-inn?return=${encodeURIComponent(FLOW)}`);
    render(<LoginFromQuery />);
    expect(loginSheet.props).toHaveBeenLastCalledWith({
      presentation: 'inline',
      returnPath: FLOW,
      vippsConfirm: null,
    });
  });

  it.each([
    ['an absolute URL', 'return=https%3A%2F%2Fevil.example%2Fbarnehage%2Fx'],
    ['a protocol-relative URL', 'return=%2F%2Fevil.example'],
    ['a backslash host', 'return=%2F%5Cevil.example'],
    ['a path outside the allowed prefixes', 'return=%2Fmin-side'],
    ['a repeated parameter', 'return=%2Fbarnehage%2Fa&return=%2Fbarnehage%2Fb'],
  ])('refuses %s', (_case, search) => {
    expect(returnPathFromSearch(`?${search}`)).toBeNull();
    window.history.replaceState(null, '', `/min-side/logg-inn?${search}`);
    render(<LoginFromQuery />);
    expect(loginSheet.props).toHaveBeenLastCalledWith({
      presentation: 'inline',
      returnPath: null,
      vippsConfirm: null,
    });
  });

  it('never puts the value on the page', () => {
    window.history.replaceState(
      null,
      '',
      `/min-side/logg-inn?return=${encodeURIComponent('/barnehage/<script>alert(1)</script>')}`
    );
    const { container } = render(<LoginFromQuery />);
    expect(container.innerHTML).not.toContain('script');
  });

  describe('a Vipps login confirmed with a code (SP10)', () => {
    it('starts the login on the code, for the masked address, and cleans the address bar', () => {
      window.history.replaceState(
        null,
        '',
        `/min-side/logg-inn?vipps=confirm_email&to=${encodeURIComponent('k•••@g•••.com')}`
      );

      render(<LoginFromQuery />);

      expect(loginSheet.props).toHaveBeenLastCalledWith({
        presentation: 'inline',
        returnPath: null,
        vippsConfirm: { to: 'k•••@g•••.com' },
      });
      // The masked address and the marker are gone from history once read.
      expect(window.location.search).toBe('');
    });

    it('keeps the code step after the address bar is cleaned and the page re-renders', () => {
      window.history.replaceState(null, '', '/min-side/logg-inn?vipps=confirm_email');
      const { rerender } = render(<LoginFromQuery />);

      rerender(<LoginFromQuery />);

      expect(loginSheet.props).toHaveBeenLastCalledWith(
        expect.objectContaining({ vippsConfirm: { to: null } })
      );
    });

    it('gives no address for one that is not the masked shape', () => {
      window.history.replaceState(
        null,
        '',
        `/min-side/logg-inn?vipps=confirm_email&to=${encodeURIComponent('<b>x</b>')}`
      );
      const { container } = render(<LoginFromQuery />);

      expect(loginSheet.props).toHaveBeenLastCalledWith(
        expect.objectContaining({ vippsConfirm: { to: null } })
      );
      expect(container.innerHTML).not.toContain('<b>');
    });
  });

  it('shows no notice for the confirm marker — the code step says it', () => {
    expect(vippsNotice(['confirm_email'])).toBeNull();
  });

  it("hands the login the app's actions and the overrides it was given", () => {
    const classNames = { loginPanel: { root: 'mine' } };
    renderInDom(
      <FromQuery
        actions={ACTIONS}
        config={PARITY_CONFIG}
        labels={TEST_LABELS}
        classNames={classNames}
      />
    );
    expect(loginSheet.wiring).toHaveBeenLastCalledWith({
      actions: ACTIONS,
      config: PARITY_CONFIG,
      labels: TEST_LABELS,
      classNames,
      components: undefined,
    });
  });

  it('prerenders the e-mail login, with no return path and no confirm', () => {
    window.history.replaceState(
      null,
      '',
      `/min-side/logg-inn?vipps=confirm_email&return=${encodeURIComponent('/bestill')}`
    );
    renderToString(
      <Parity>
        <LoginFromQuery />
      </Parity>
    );
    expect(loginSheet.props).toHaveBeenLastCalledWith({
      presentation: 'inline',
      returnPath: null,
      vippsConfirm: null,
    });
  });
});
