import { mergeLabels } from "@medalsocial/booking/react/shared";
import { BookingWizard } from "@medalsocial/booking/react/wizard";
import { redirect } from "next/navigation";
import { booking } from "../../lib/booking";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The booking page: the loader decides (hand off, unavailable, or ready with
 * the seed), the page renders `<BookingWizard>` from `/react/wizard`, the
 * booking page's own entry (the `/react` barrel would bring the manage page and
 * the portal along). The label pack is resolved here, on the server, so the
 * browser bundle carries no copy. (This smoke target loads no stylesheet; a
 * real site imports meda's `bridge.css`, `primitives/styles.css` and
 * `booking/styles.css` into its Tailwind v4 build.)
 */
export default async function BookingPage({ searchParams }: Props) {
  const page = await booking.loadBookingPage({ searchParams: await searchParams });
  if (page.kind === "redirect") redirect(page.href);
  if (page.kind === "unavailable") {
    return (
      <main>
        <h1>Bestill time</h1>
        <p>Timeboken svarer ikke akkurat nå. Ring oss på {page.contact.phone}.</p>
      </main>
    );
  }
  return (
    <main>
      <h1>Bestill time</h1>
      <BookingWizard
        config={page.config}
        labels={mergeLabels(page.config.locale)}
        seed={page.seed}
        guardian={page.guardian}
        contact={page.contact}
        rangeDays={page.rangeDays}
      />
    </main>
  );
}
