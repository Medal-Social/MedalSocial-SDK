#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the coverage table intentionally lists literal `${...}` snippets expected in SDK source.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const specPath = resolve("dist/openapi/medal-social.openapi.json");
if (!existsSync(specPath)) {
  console.error(
    "[openapi-coverage] Missing bundled OpenAPI JSON. Run `pnpm openapi:bundle` first.",
  );
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, "utf8"));

const expected = [
  ["get", "/api/v1/posts", "listPosts", "src/resources/posts.ts", "get", "/api/v1/posts"],
  ["post", "/api/v1/posts", "createPost", "src/resources/posts.ts", "postOnce", "/api/v1/posts"],
  [
    "get",
    "/api/v1/posts/{id}",
    "getPost",
    "src/resources/posts.ts",
    "get",
    "/api/v1/posts/${encodeURIComponent(id)}",
  ],
  [
    "patch",
    "/api/v1/posts/{id}",
    "updatePost",
    "src/resources/posts.ts",
    "patch",
    "/api/v1/posts/${encodeURIComponent(id)}",
  ],
  [
    "delete",
    "/api/v1/posts/{id}",
    "deletePost",
    "src/resources/posts.ts",
    "delete",
    "/api/v1/posts/${encodeURIComponent(id)}",
  ],
  [
    "post",
    "/api/v1/posts/{id}/schedule",
    "schedulePost",
    "src/resources/posts.ts",
    "post",
    "/api/v1/posts/${encodeURIComponent(id)}/schedule",
  ],
  [
    "post",
    "/api/v1/posts/{id}/publish",
    "publishPost",
    "src/resources/posts.ts",
    "post",
    "/api/v1/posts/${encodeURIComponent(id)}/publish",
  ],
  [
    "get",
    "/api/v1/posts/channels",
    "listPostChannels",
    "src/resources/posts.ts",
    "get",
    "/api/v1/posts/channels",
  ],
  ["post", "/api/v1/emails", "sendEmail", "src/resources/emails.ts", "postOnce", "/api/v1/emails"],
  [
    "get",
    "/api/v1/emails/{id}",
    "getEmailSend",
    "src/resources/emails.ts",
    "get",
    "/api/v1/emails/${encodeURIComponent(id)}",
  ],
  [
    "post",
    "/api/v1/emails/batch",
    "batchSendEmails",
    "src/resources/emails.ts",
    "postOnce",
    "/api/v1/emails/batch",
  ],
  [
    "get",
    "/api/v1/emails/templates",
    "listEmailTemplates",
    "src/resources/emails.ts",
    "get",
    "/api/v1/emails/templates",
  ],
  [
    "get",
    "/api/v1/emails/templates/{slug}",
    "getEmailTemplate",
    "src/resources/emails.ts",
    "get",
    "/api/v1/emails/templates/${encodeURIComponent(slug)}",
  ],
  [
    "get",
    "/api/v1/contacts",
    "listContacts",
    "src/resources/contacts.ts",
    "get",
    "/api/v1/contacts",
  ],
  [
    "post",
    "/api/v1/contacts",
    "createContact",
    "src/resources/contacts.ts",
    "postOnce",
    "/api/v1/contacts",
  ],
  [
    "get",
    "/api/v1/contacts/{id}",
    "getContact",
    "src/resources/contacts.ts",
    "get",
    "/api/v1/contacts/${encodeURIComponent(id)}",
  ],
  [
    "patch",
    "/api/v1/contacts/{id}",
    "updateContact",
    "src/resources/contacts.ts",
    "patch",
    "/api/v1/contacts/${encodeURIComponent(id)}",
  ],
  [
    "delete",
    "/api/v1/contacts/{id}",
    "deleteContact",
    "src/resources/contacts.ts",
    "delete",
    "/api/v1/contacts/${encodeURIComponent(id)}",
  ],
  [
    "get",
    "/api/v1/contacts/{id}/activities",
    "listContactActivities",
    "src/resources/contacts.ts",
    "get",
    "/api/v1/contacts/${encodeURIComponent(id)}/activities",
  ],
  [
    "post",
    "/api/v1/contacts/{id}/notes",
    "addContactNote",
    "src/resources/contacts.ts",
    "postOnce",
    "/api/v1/contacts/${encodeURIComponent(id)}/notes",
  ],
  [
    "post",
    "/api/v1/contacts/import",
    "importContacts",
    "src/resources/contacts.ts",
    "postOnce",
    "/api/v1/contacts/import",
  ],
  ["get", "/api/v1/deals", "listDeals", "src/resources/deals.ts", "get", "/api/v1/deals"],
  ["post", "/api/v1/deals", "createDeal", "src/resources/deals.ts", "postOnce", "/api/v1/deals"],
  [
    "get",
    "/api/v1/deals/{id}",
    "getDeal",
    "src/resources/deals.ts",
    "get",
    "/api/v1/deals/${encodeURIComponent(id)}",
  ],
  [
    "patch",
    "/api/v1/deals/{id}",
    "updateDeal",
    "src/resources/deals.ts",
    "patch",
    "/api/v1/deals/${encodeURIComponent(id)}",
  ],
  [
    "delete",
    "/api/v1/deals/{id}",
    "deleteDeal",
    "src/resources/deals.ts",
    "delete",
    "/api/v1/deals/${encodeURIComponent(id)}",
  ],
  [
    "get",
    "/api/v1/bookings",
    "listBookings",
    "src/resources/bookings.ts",
    "get",
    "/api/v1/bookings",
  ],
  [
    "post",
    "/api/v1/bookings",
    "createBooking",
    "src/resources/bookings.ts",
    "postOnce",
    "/api/v1/bookings",
  ],
  [
    "get",
    "/api/v1/bookings/services",
    "listBookingServices",
    "src/resources/bookings.ts",
    "get",
    "/api/v1/bookings/services",
  ],
  [
    "get",
    "/api/v1/bookings/resources",
    "listBookingResources",
    "src/resources/bookings.ts",
    "get",
    "/api/v1/bookings/resources",
  ],
  [
    "get",
    "/api/v1/bookings/availability",
    "listBookingAvailability",
    "src/resources/bookings.ts",
    "get",
    "/api/v1/bookings/availability",
  ],
  [
    "get",
    "/api/v1/bookings/{id}",
    "getBooking",
    "src/resources/bookings.ts",
    "get",
    "/api/v1/bookings/${encodeURIComponent(id)}",
  ],
  [
    "patch",
    "/api/v1/bookings/{id}",
    "updateBooking",
    "src/resources/bookings.ts",
    "patch",
    "/api/v1/bookings/${encodeURIComponent(id)}",
  ],
  [
    "post",
    "/api/v1/bookings/{id}/cancel",
    "cancelBooking",
    "src/resources/bookings.ts",
    "postOnce",
    "/api/v1/bookings/${encodeURIComponent(id)}/cancel",
  ],
  [
    "post",
    "/api/v1/bookings/{id}/reschedule",
    "rescheduleBooking",
    "src/resources/bookings.ts",
    "postOnce",
    "/api/v1/bookings/${encodeURIComponent(id)}/reschedule",
  ],
  [
    "post",
    "/api/v1/bookings/{id}/no-show",
    "markBookingNoShow",
    "src/resources/bookings.ts",
    "postOnce",
    "/api/v1/bookings/${encodeURIComponent(id)}/no-show",
  ],
  [
    "get",
    "/api/v1/bookings/manage/{token}",
    "getManagedBooking",
    "src/resources/bookings.ts",
    "get",
    "/api/v1/bookings/manage/${encodeURIComponent(token)}",
  ],
  [
    "post",
    "/api/v1/bookings/manage/{token}/cancel",
    "cancelManagedBooking",
    "src/resources/bookings.ts",
    "postOnce",
    "/api/v1/bookings/manage/${encodeURIComponent(token)}/cancel",
  ],
  [
    "post",
    "/api/v1/bookings/manage/{token}/reschedule",
    "rescheduleManagedBooking",
    "src/resources/bookings.ts",
    "postOnce",
    "/api/v1/bookings/manage/${encodeURIComponent(token)}/reschedule",
  ],
  [
    "post",
    "/api/v1/gdpr/export",
    "requestGdprExport",
    "src/resources/gdpr.ts",
    "postOnce",
    "/api/v1/gdpr/export",
  ],
  [
    "get",
    "/api/v1/gdpr/exports",
    "listGdprExports",
    "src/resources/gdpr.ts",
    "get",
    "/api/v1/gdpr/exports",
  ],
  [
    "get",
    "/api/v1/gdpr/exports/{id}",
    "getGdprExport",
    "src/resources/gdpr.ts",
    "get",
    "/api/v1/gdpr/exports/${encodeURIComponent(id)}",
  ],
  [
    "post",
    "/api/v1/gdpr/consent",
    "recordGdprConsent",
    "src/resources/gdpr.ts",
    "post",
    "/api/v1/gdpr/consent",
  ],
  [
    "get",
    "/api/v1/gdpr/consent/{email}",
    "getGdprConsent",
    "src/resources/gdpr.ts",
    "get",
    "/api/v1/gdpr/consent/${encodeURIComponent(email)}",
  ],
  [
    "post",
    "/api/cookie-consent",
    "recordCookieConsent",
    "src/resources/gdpr.ts",
    "post",
    "/api/cookie-consent",
  ],
  [
    "get",
    "/api/v1/me/workspaces",
    "listWorkspaces",
    "src/resources/workspaces.ts",
    "get",
    "/api/v1/me/workspaces",
  ],
  [
    "get",
    "/api/v1/helpdesk/conversations",
    "listHelpdeskConversations",
    "src/resources/helpdesk.ts",
    "get",
    "/api/v1/helpdesk/conversations",
  ],
  [
    "get",
    "/api/v1/helpdesk/conversations/{id}",
    "getHelpdeskConversation",
    "src/resources/helpdesk.ts",
    "get",
    "/api/v1/helpdesk/conversations/${encodeURIComponent(id)}",
  ],
  [
    "patch",
    "/api/v1/helpdesk/conversations/{id}",
    "updateHelpdeskConversation",
    "src/resources/helpdesk.ts",
    "patch",
    "/api/v1/helpdesk/conversations/${encodeURIComponent(id)}",
  ],
  [
    "get",
    "/api/v1/helpdesk/conversations/{id}/messages",
    "listHelpdeskConversationMessages",
    "src/resources/helpdesk.ts",
    "get",
    "/api/v1/helpdesk/conversations/${encodeURIComponent(id)}/messages",
  ],
  [
    "post",
    "/api/v1/helpdesk/replies",
    "createHelpdeskReply",
    "src/resources/helpdesk.ts",
    "postOnce",
    "/api/v1/helpdesk/replies",
  ],
  [
    "get",
    "/api/v1/webhooks",
    "listWebhooks",
    "src/resources/webhooks.ts",
    "get",
    "/api/v1/webhooks",
  ],
  [
    "post",
    "/api/v1/webhooks",
    "createWebhook",
    "src/resources/webhooks.ts",
    "postOnce",
    "/api/v1/webhooks",
  ],
  [
    "get",
    "/api/v1/webhooks/{id}",
    "getWebhook",
    "src/resources/webhooks.ts",
    "get",
    "/api/v1/webhooks/${encodeURIComponent(id)}",
  ],
  [
    "patch",
    "/api/v1/webhooks/{id}",
    "updateWebhook",
    "src/resources/webhooks.ts",
    "patch",
    "/api/v1/webhooks/${encodeURIComponent(id)}",
  ],
  [
    "delete",
    "/api/v1/webhooks/{id}",
    "deleteWebhook",
    "src/resources/webhooks.ts",
    "delete",
    "/api/v1/webhooks/${encodeURIComponent(id)}",
  ],
  [
    "get",
    "/api/v1/webhooks/{id}/deliveries",
    "listWebhookDeliveries",
    "src/resources/webhooks.ts",
    "get",
    "/api/v1/webhooks/${encodeURIComponent(id)}/deliveries",
  ],
  [
    "post",
    "/api/v1/webhooks/{id}/test",
    "testWebhook",
    "src/resources/webhooks.ts",
    "post",
    "/api/v1/webhooks/${encodeURIComponent(id)}/test",
  ],
  [
    "post",
    "/api/v1/capability-confirmations",
    "issueCapabilityConfirmation",
    "src/resources/capability-confirmations.ts",
    "post",
    "/api/v1/capability-confirmations",
  ],
  [
    "post",
    "/api/v1/channels/connect-links",
    "createChannelConnectLink",
    "src/resources/channels.ts",
    "postOnce",
    "/api/v1/channels/connect-links",
  ],
  [
    "get",
    "/api/v1/channels/connect-links",
    "listChannelConnectLinks",
    "src/resources/channels.ts",
    "get",
    "/api/v1/channels/connect-links",
  ],
  [
    "delete",
    "/api/v1/channels/connect-links/{id}",
    "revokeChannelConnectLink",
    "src/resources/channels.ts",
    "delete",
    "/api/v1/channels/connect-links/${encodeURIComponent(id)}",
  ],
  [
    "get",
    "/api/v1/channels/connections",
    "listChannelConnections",
    "src/resources/channels.ts",
    "get",
    "/api/v1/channels/connections",
  ],
  [
    "delete",
    "/api/v1/channels/connections/{id}",
    "disconnectChannelConnection",
    "src/resources/channels.ts",
    "delete",
    "/api/v1/channels/connections/${encodeURIComponent(id)}",
  ],
  ["post", "/api/v1/scan", "createScan", "src/resources/scan.ts", "postOnce", "/api/v1/scan"],
  [
    "get",
    "/api/v1/scan/companies",
    "searchScanCompanies",
    "src/resources/scan.ts",
    "get",
    "/api/v1/scan/companies",
  ],
  [
    "get",
    "/api/v1/scan/{id}",
    "getScan",
    "src/resources/scan.ts",
    "get",
    "/api/v1/scan/${encodeURIComponent(id)}",
  ],
];

const errors = [];
const sourceCache = new Map();
const openApiMethods = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

/**
 * @param {string} sourcePath
 * @returns {string | null}
 */
function readSourceFile(sourcePath) {
  if (sourceCache.has(sourcePath)) {
    return sourceCache.get(sourcePath);
  }

  const resolvedSourcePath = resolve(sourcePath);
  if (!existsSync(resolvedSourcePath)) {
    errors.push(`${sourcePath} does not exist for SDK coverage checks`);
    sourceCache.set(sourcePath, null);
    return null;
  }

  try {
    const source = readFileSync(resolvedSourcePath, "utf8");
    sourceCache.set(sourcePath, source);
    return source;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to read ${sourcePath}: ${message}`);
    sourceCache.set(sourcePath, null);
    return null;
  }
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} source
 * @param {string} clientMethod
 * @param {string} pathArgument
 */
function hasClientCall(source, clientMethod, pathArgument) {
  const escapedPath = escapeRegExp(pathArgument);
  const callPattern = new RegExp(`this\\.client\\.${clientMethod}\\(\\s*(["'\`])${escapedPath}\\1`);
  return callPattern.test(source);
}

if (spec.openapi !== "3.1.0") {
  errors.push(`Expected openapi 3.1.0, got ${spec.openapi ?? "<missing>"}`);
}

if (spec.jsonSchemaDialect !== "https://json-schema.org/draft/2020-12/schema") {
  errors.push("Expected JSON Schema 2020-12 dialect declaration.");
}

const expectedOperationKeys = new Map();
for (const [method, path, operationId] of expected) {
  const key = `${method.toUpperCase()} ${path}`;
  if (expectedOperationKeys.has(key)) {
    errors.push(`${key} is duplicated in expected OpenAPI coverage entries`);
  }
  expectedOperationKeys.set(key, operationId);
}

for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
  if (!pathItem || typeof pathItem !== "object") {
    continue;
  }

  for (const [method, operation] of Object.entries(pathItem)) {
    if (!openApiMethods.has(method)) {
      continue;
    }

    const key = `${method.toUpperCase()} ${path}`;
    if (!expectedOperationKeys.has(key)) {
      const operationId = operation?.operationId ?? "<missing operationId>";
      errors.push(`OpenAPI operation ${key} (${operationId}) is not covered by the SDK matrix`);
    }
  }
}

for (const [method, path, operationId, sourcePath, clientMethod, sourceNeedle] of expected) {
  const operation = spec.paths?.[path]?.[method];
  if (!operation) {
    errors.push(`Missing OpenAPI operation ${method.toUpperCase()} ${path}`);
    continue;
  }
  if (operation.operationId !== operationId) {
    errors.push(
      `${method.toUpperCase()} ${path} has operationId ${
        operation.operationId ?? "<missing>"
      }; expected ${operationId}`,
    );
  }
  if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
    errors.push(`${operationId} is missing tags`);
  }

  const source = readSourceFile(sourcePath);
  if (source === null) {
    continue;
  }

  if (!hasClientCall(source, clientMethod, sourceNeedle)) {
    errors.push(
      `${sourcePath} is missing this.client.${clientMethod}(${sourceNeedle}) for ${operationId}`,
    );
  }
}

if (errors.length > 0) {
  console.error(`[openapi-coverage] FAIL — ${errors.length} issue(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`[openapi-coverage] OK — ${expected.length} SDK operations covered by OpenAPI 3.1.`);
