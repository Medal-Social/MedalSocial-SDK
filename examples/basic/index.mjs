import "dotenv/config";
import MedalSocialClient from "@medalsocial/sdk";

async function main() {
  const client = new MedalSocialClient({
    baseUrl: "https://api.medal.social",
    auth: {
      kind: "basic",
      clientId: process.env.MEDAL_CLIENT_ID,
      clientSecret: process.env.MEDAL_CLIENT_SECRET,
    },
  });

  const res = await client.createLead([
    { name: "Alex Ali", email: "lead.test@example.com", company: "", source: "website" },
  ]);
  console.log("createLead status:", res.status);
  console.log("createLead data:", res.data);

  const noteRes = await client.createNote({
    name: "Test Testnes",
    email: "test@medalsocial.com",
    company: "Medal Social Test company",
    phone: "+47 48212345",
    content: "Hi there, I want to buy a car",
    metadata: { Budget: "$100,000" },
  });
  console.log("createNote status:", noteRes.status);
  console.log("createNote data:", noteRes.data);

  const consentRes = await client.createCookieConsent({
    domain: "example.com",
    consentStatus: "partial",
    consentTimestamp: "2025-06-04T10:30:00Z",
    ipAddress: "88.151.164.19",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    cookiePreferences: {
      necessary: {
        allowed: true,
        cookieRecords: [
          {
            cookie: "session_id",
            duration: "Session",
            description: "Essential for user authentication and session management",
          },
          {
            cookie: "csrf_token",
            duration: "Session",
            description: "Required for security and preventing CSRF attacks",
          },
          {
            cookie: "user_preferences",
            duration: "1 year",
            description: "Stores user language and accessibility preferences",
          },
        ],
      },
      analytics: {
        allowed: false,
        cookieRecords: [
          {
            cookie: "ga_tracking",
            duration: "2 years",
            description: "Google Analytics tracking for website usage statistics",
          },
          {
            cookie: "hotjar_session",
            duration: "30 minutes",
            description: "Hotjar user session recording and heatmap tracking",
          },
          {
            cookie: "_gid",
            duration: "24 hours",
            description: "Google Analytics identifier for unique users",
          },
        ],
      },
      marketing: {
        allowed: true,
        cookieRecords: [
          {
            cookie: "fb_pixel",
            duration: "90 days",
            description: "Facebook Pixel for retargeting and conversion tracking",
          },
          {
            cookie: "google_ads",
            duration: "90 days",
            description: "Google Ads conversion tracking and remarketing",
          },
        ],
      },
      functional: {
        allowed: true,
        cookieRecords: [
          {
            cookie: "chat_widget",
            duration: "1 month",
            description: "Live chat functionality and support history",
          },
          {
            cookie: "video_quality",
            duration: "Session",
            description: "Video player quality and playback preferences",
          },
        ],
      },
    },
  });
  console.log("createCookieConsent status:", consentRes.status);
  console.log("createCookieConsent data:", consentRes.data);

  const signupRes = await client.createEventSignup({
    contact: {
      name: "Test Testnes",
      email: "test@medalsocial.com",
      company: "Medal Social Test company",
    },
    event: {
      externalId: "eksadaasdasd",
      name: "Product saus asd",
      description: "Learn about our new product asd",
      time: "2025-06-15T14:00:00Z",
      location: "Online",
      thumbnail:
        "https://medalsocialdevstorage.blob.core.windows.net/images/d05bad9e-bc52-4f8e-8191-d6944d34055c.jpg",
    },
  });
  console.log("createEventSignup status:", signupRes.status);
  console.log("createEventSignup data:", signupRes.data);

  const emailRes = await client.sendTransactionalEmail({
    to: "test@medalsocial.com",
    slug: "test",
    additionalData: { test: "https://medalsocial.com/" },
  });
  console.log("sendTransactionalEmail status:", emailRes.status);
  console.log("sendTransactionalEmail data:", emailRes.data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
