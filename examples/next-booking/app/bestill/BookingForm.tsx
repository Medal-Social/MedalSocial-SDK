"use client";

import type { BookingServiceDto, BookingSlotDto } from "@medalsocial/booking/core";
import { useState } from "react";

interface Props {
  services: BookingServiceDto[];
  slots: Record<string, BookingSlotDto[]>;
  api: string;
  manage: string;
}

type Outcome =
  | { kind: "idle" }
  | { kind: "booked"; manageHref: string }
  | { kind: "error"; code: string };

function time(ts: number): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
}

/** Service → slot → phone → book, against the package's own create route. */
export function BookingForm({ services, slots, api, manage }: Props) {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [slot, setSlot] = useState<BookingSlotDto | null>(null);
  const [phone, setPhone] = useState("");
  const [terms, setTerms] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [nonce] = useState(() => crypto.randomUUID());

  if (outcome.kind === "booked") {
    return (
      <section>
        <h2>Timen er bestilt</h2>
        <a href={outcome.manageHref}>Se eller endre timen</a>
      </section>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceId || !slot) return;
    const response = await fetch(`${api}/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ serviceId, resourceId: slot.resourceId, startTs: slot.startTs }],
        contact: { phone, name: "Demo" },
        consentTerms: terms,
        submissionNonce: nonce,
      }),
    });
    const body = await response.json();
    if (response.status === 201) {
      const token: string = body.bookings[0].manageToken;
      setOutcome({ kind: "booked", manageHref: `${manage}/${encodeURIComponent(token)}` });
    } else {
      setOutcome({ kind: "error", code: body.error });
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset>
        <legend>Behandling</legend>
        {services
          .filter((service) => service.bookableOnline)
          .map((service) => (
            <label key={service.id} style={{ display: "block" }}>
              <input
                type="radio"
                name="service"
                value={service.id}
                checked={serviceId === service.id}
                onChange={() => {
                  setServiceId(service.id);
                  setSlot(null);
                }}
              />
              {service.name}
            </label>
          ))}
      </fieldset>
      {serviceId && (
        <fieldset>
          <legend>Tidspunkt</legend>
          {(slots[serviceId] ?? []).map((option) => (
            <button
              key={`${option.startTs}-${option.resourceId}`}
              type="button"
              aria-pressed={slot?.startTs === option.startTs}
              onClick={() => setSlot(option)}
            >
              {time(option.startTs)}
            </button>
          ))}
        </fieldset>
      )}
      <label style={{ display: "block" }}>
        Telefon
        <input name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      <label style={{ display: "block" }}>
        <input
          type="checkbox"
          name="terms"
          checked={terms}
          onChange={(event) => setTerms(event.target.checked)}
        />
        Jeg godtar vilkårene
      </label>
      <button type="submit" disabled={!serviceId || !slot}>
        Bekreft
      </button>
      {outcome.kind === "error" && <p role="alert">Noe gikk galt ({outcome.code})</p>}
    </form>
  );
}
