import { Medal } from "@medalsocial/sdk";

async function main() {
  const medal = new Medal(process.env.MEDAL_API_KEY, {
    baseUrl: process.env.MEDAL_BASE_URL, // Your Convex site URL
  });

  // === Emails ===

  // Send a transactional email
  const { data: sent } = await medal.emails.send({
    template_slug: "welcome",
    to: "user@example.com",
    name: "John Doe",
    variables: { company: "Acme Corp" },
  });
  console.log("Email sent:", sent.id, sent.status);

  // Check email status
  const { data: email } = await medal.emails.get(sent.id);
  console.log("Email status:", email.status);

  // List templates
  const { data: templates } = await medal.emails.templates.list();
  console.log("Templates:", templates.map((t) => t.slug));

  // === Contacts ===

  // Create a contact
  const { data: contact } = await medal.contacts.create({
    email: "john@example.com",
    first_name: "John",
    last_name: "Doe",
    company: "Acme Corp",
    status: "lead",
  });
  console.log("Contact created:", contact.id);

  // List contacts with filters
  const contacts = await medal.contacts.list({
    status: "lead",
    limit: 10,
  });
  console.log("Contacts:", contacts.data.length, "has_more:", contacts.pagination.has_more);

  // Add a note
  const { data: note } = await medal.contacts.addNote(contact.id, {
    content: "Follow up next week about the proposal.",
  });
  console.log("Note added:", note.activity_id);

  // === Deals ===

  // Create a deal
  const { data: deal } = await medal.deals.create({
    title: "Acme Enterprise Partnership",
    value: 50000,
    currency: "USD",
    contact_id: contact.id,
  });
  console.log("Deal created:", deal.id);

  // Update deal status
  const { data: updated } = await medal.deals.update(deal.id, { status: "won" });
  console.log("Deal updated:", updated.status);

  // === GDPR ===

  // Record consent
  const { data: consent } = await medal.gdpr.recordConsent({
    email: "john@example.com",
    consent_type: "marketing_email",
    granted: true,
    source: "signup_form",
  });
  console.log("Consent recorded:", consent.consent_id);

  // Check consent status
  const { data: consentStatus } = await medal.gdpr.getConsent("john@example.com");
  console.log("Consents:", consentStatus.consents.length);

  // Request workspace export
  const { data: exportReq } = await medal.gdpr.requestExport();
  console.log("Export requested:", exportReq.request_id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
