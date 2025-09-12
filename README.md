## Medal Social SDK (TypeScript)

Simple, typed client for the Medal Social API. Supports authentication via Client ID/Secret (Basic) today and Bearer token. Provides convenience methods for common create actions.

### Install

```bash
corepack enable
pnpm add @medalsocial/sdk
```

### Quick start

```ts
import MedalSocialClient from '@medalsocial/sdk';

const client = new MedalSocialClient({
  auth: { kind: 'basic', clientId: process.env.MEDAL_CLIENT_ID!, clientSecret: process.env.MEDAL_CLIENT_SECRET! },
  // or: auth: { kind: 'bearer', token: process.env.MEDAL_API_TOKEN! },
  // optional: baseUrl: 'https://api.medalsocial.com',
});

// Create lead(s)
await client.createLead([
  {
    name: 'Alex Example',
    email: 'lead.test@example.com',
    company: '',
    source: 'website',
  },
]);

// Create a note
await client.createNote({
  name: 'Test Testnes',
  email: 'test@medalsocial.com',
  company: 'Medal Social Test company',
  phone: '+47 12345678',
  content: 'Hei jeg skal gjerne sende to konteinere til USA.',
  metadata: { Budsjett: '$100,000' },
});

// Record cookie consent
await client.createCookieConsent({
  domain: 'example.com',
  consentStatus: 'partial',
  consentTimestamp: '2025-06-04T10:30:00Z',
  ipAddress: '88.151.164.19',
  userAgent: 'Mozilla/5.0',
  cookiePreferences: {
    necessary: {
      allowed: true,
      cookieRecords: [
        { cookie: 'session_id', duration: 'Session', description: 'Essential for user authentication and session management' },
      ],
    },
    analytics: { allowed: false },
    marketing: { allowed: true },
    functional: { allowed: true },
  },
});

// Create event signup
await client.createEventSignup({
  contact: {
    name: 'Test Testnes',
    email: 'test@medalsocial.com',
    company: 'Medal Social Test company',
  },
  event: {
    externalId: 'eksadaasdasd',
    name: 'Product saus asd',
    description: 'Learn about our new product asd',
    time: '2025-06-15T14:00:00Z',
    location: 'Online',
    thumbnail: 'https://medalsocialdevstorage.blob.core.windows.net/images/d05bad9e-bc52-4f8e-8191-d6944d34055c.jpg',
  },
});
```

### API

- `new MedalSocialClient(options)`
  - **auth** (required):
    - `{ kind: 'basic', clientId: string, clientSecret: string }`
    - `{ kind: 'bearer', token: string }`
  - **baseUrl** (optional): string. Defaults to `https://api.medalsocial.com`.
  - **timeoutMs** (optional): number. Defaults to 30000.
  - **userAgent** (optional): string.
  - **fetch** (optional): custom fetch implementation to override transport.

- `createLead(items: { name, email, company?, source? }[])` -> `{ status, data, headers }`
- `createNote(input)` -> `{ status, data, headers }`
- `createCookieConsent(input)` -> `{ status, data, headers }`
- `createEventSignup(input)` -> `{ status, data, headers }`
- `sendTransactionalEmail(input)` -> `{ status, data, headers }`

Responses throw on non-2xx with an error containing `status` and `details` (parsed body when available).

### Runtime support

- Node 20+ and modern browsers. The client uses `fetch`; in Node 20+ `fetch` is built-in. For older environments, provide a global `fetch` polyfill.

### Docs

- API Reference (TypeDoc): published automatically from the `prod` branch via GitHub Pages.
- Local: `pnpm docs` then open `docs/index.html`.

### Contributing

PRs welcome! Use pnpm. Useful scripts:

```bash
pnpm install
pnpm build
pnpm test
pnpm docs
```

### License

MIT


