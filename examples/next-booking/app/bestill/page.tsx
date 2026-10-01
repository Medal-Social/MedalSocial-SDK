import { redirect } from "next/navigation";
import { booking } from "../../lib/booking";
import { BookingForm } from "./BookingForm";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The booking page: the loader decides (hand off, unavailable, or ready with
 * the seed), the page renders. A real site renders `<BookingWizard>` from
 * `@medalsocial/booking/react`; this smoke target keeps the UI to a form.
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
      <BookingForm
        services={page.seed.services}
        slots={page.seed.slots}
        api={page.config.paths.api}
        manage={page.config.paths.manage}
      />
    </main>
  );
}
