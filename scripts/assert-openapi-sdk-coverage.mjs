#!/usr/bin/env node
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
  ["post", "/api/v1/posts", "createPost", "src/resources/posts.ts", "post", "/api/v1/posts"],
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
  ["post", "/api/v1/emails", "sendEmail", "src/resources/emails.ts", "post", "/api/v1/emails"],
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
    "post",
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
    "post",
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
    "post",
    "/api/v1/contacts/${encodeURIComponent(id)}/notes",
  ],
  [
    "post",
    "/api/v1/contacts/import",
    "importContacts",
    "src/resources/contacts.ts",
    "post",
    "/api/v1/contacts/import",
  ],
  ["get", "/api/v1/deals", "listDeals", "src/resources/deals.ts", "get", "/api/v1/deals"],
  ["post", "/api/v1/deals", "createDeal", "src/resources/deals.ts", "post", "/api/v1/deals"],
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
    "post",
    "/api/v1/gdpr/export",
    "requestGdprExport",
    "src/resources/gdpr.ts",
    "post",
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
];

const errors = [];

if (spec.openapi !== "3.1.0") {
  errors.push(`Expected openapi 3.1.0, got ${spec.openapi ?? "<missing>"}`);
}

if (spec.jsonSchemaDialect !== "https://json-schema.org/draft/2020-12/schema") {
  errors.push("Expected JSON Schema 2020-12 dialect declaration.");
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

  const source = readFileSync(sourcePath, "utf8");
  if (!source.includes(`this.client.${clientMethod}(`)) {
    errors.push(`${sourcePath} is missing this.client.${clientMethod}( for ${operationId}`);
  }
  if (!source.includes(sourceNeedle)) {
    errors.push(`${sourcePath} is missing path fragment ${sourceNeedle} for ${operationId}`);
  }
}

if (errors.length > 0) {
  console.error(`[openapi-coverage] FAIL — ${errors.length} issue(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`[openapi-coverage] OK — ${expected.length} SDK operations covered by OpenAPI 3.1.`);
