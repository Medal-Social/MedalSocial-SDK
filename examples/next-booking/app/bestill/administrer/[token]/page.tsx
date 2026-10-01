import { booking } from "../../../../lib/booking";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string }> };

/** The manage page: the loader reads the booking the token names. */
export default async function ManagePage({ params }: Props) {
  const { token } = await params;
  const page = await booking.loadManagePage(token);
  if (page.kind === "unreachable") return <p>Prøv igjen om litt.</p>;
  if (page.kind === "unknown") return <p>Vi finner ikke denne timen.</p>;
  return (
    <main>
      <h1>Timen din</h1>
      <p>
        {page.booking.serviceName} · {page.booking.status}
      </p>
    </main>
  );
}
