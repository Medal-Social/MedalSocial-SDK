/**
 * One person, several services, ONE visit — performed back to back by one
 * stylist. The engine's model: the duration is the SUM of the services', the
 * buffer before is the FIRST service's, the buffer after is the LAST's, there
 * is no buffer between a person's own services, and each service is priced on
 * its own. Everything that times or prices a line goes through these helpers so
 * a one-service line and a three-service line share one path.
 */

import type { WizardItem, WizardService } from './machine';

/** The timing of a whole visit. */
export interface VisitTiming {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/** A person's services in order: the first, then the extras. */
export function visitServicesOf(
  item: Pick<WizardItem, 'service' | 'extraServices'>
): WizardService[] {
  return [item.service, ...(item.extraServices ?? [])];
}

/** The timing of an ordered, non-empty list of services. Throws on an empty list. */
export function visitOfServices(services: readonly WizardService[]): VisitTiming {
  const first = services[0];
  const last = services[services.length - 1];
  if (!first || !last) throw new Error('a visit needs at least one service');
  return {
    durationMinutes: services.reduce((sum, s) => sum + s.durationMinutes, 0),
    bufferBeforeMinutes: first.bufferBeforeMinutes,
    bufferAfterMinutes: last.bufferAfterMinutes,
  };
}

/** The timing of a person's visit, from a line item or a list of services. */
export function visitOf(
  itemOrServices: Pick<WizardItem, 'service' | 'extraServices'> | readonly WizardService[]
): VisitTiming {
  return visitOfServices(
    Array.isArray(itemOrServices)
      ? itemOrServices
      : visitServicesOf(itemOrServices as Pick<WizardItem, 'service' | 'extraServices'>)
  );
}

/**
 * A visit's ids joined with `+`, in order; a single service is its id
 * unchanged. The server keys its slot cache and its `freshSlots` answer with
 * this too, so the wizard and the server can never disagree on a visit's name.
 */
export function visitKeyOfIds(serviceIds: readonly string[]): string {
  return serviceIds.join('+');
}

/** The service ids joined with `+`, in order; a single service is its id unchanged. */
export function visitKey(
  itemOrServices: Pick<WizardItem, 'service' | 'extraServices'> | readonly WizardService[]
): string {
  const services = Array.isArray(itemOrServices)
    ? (itemOrServices as readonly WizardService[])
    : visitServicesOf(itemOrServices as Pick<WizardItem, 'service' | 'extraServices'>);
  return visitKeyOfIds(services.map((s) => s.id));
}

/** The visit's price: each service priced on its own, then summed. */
export function visitPriceOre(
  services: readonly WizardService[],
  priceOf: (service: WizardService) => number
): number {
  return services.reduce((sum, s) => sum + priceOf(s), 0);
}
