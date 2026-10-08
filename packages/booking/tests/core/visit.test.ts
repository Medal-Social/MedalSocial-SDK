import { describe, expect, it } from 'vitest';
import type { WizardService } from '../../src/core';
import {
  visitKey,
  visitKeyOfIds,
  visitOf,
  visitOfServices,
  visitPriceOre,
  visitServicesOf,
} from '../../src/core';

function svc(id: string, durationMinutes: number, before = 0, after = 0): WizardService {
  return {
    id,
    name: id,
    durationMinutes,
    bufferBeforeMinutes: before,
    bufferAfterMinutes: after,
  } as unknown as WizardService;
}

const klipp = svc('klipp', 30, 5, 2);
const vask = svc('vask', 15, 3, 4);
const skjegg = svc('skjegg', 20, 7, 9);

describe('visit helpers', () => {
  it('one service is the identity', () => {
    expect(visitServicesOf({ service: klipp })).toEqual([klipp]);
    expect(visitOf({ service: klipp })).toEqual({
      durationMinutes: 30,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 2,
    });
    expect(visitKey({ service: klipp })).toBe('klipp');
  });

  it('three services sum the duration, keep the first buffer before and the last after', () => {
    const item = { service: klipp, extraServices: [vask, skjegg] };
    expect(visitServicesOf(item)).toEqual([klipp, vask, skjegg]);
    expect(visitOf(item)).toEqual({
      durationMinutes: 65,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 9,
    });
    expect(visitOfServices([klipp, vask, skjegg])).toEqual(visitOf(item));
  });

  it('key order matters', () => {
    expect(visitKey([klipp, vask])).toBe('klipp+vask');
    expect(visitKey([vask, klipp])).toBe('vask+klipp');
    expect(visitKey([klipp, vask])).not.toBe(visitKey([vask, klipp]));
    expect(visitKey([klipp])).toBe('klipp');
  });

  it('times a plain list of services as it times a line item', () => {
    expect(visitOf([klipp, vask])).toEqual(visitOf({ service: klipp, extraServices: [vask] }));
  });

  it('names a visit from its ids exactly as from its services — the server’s key', () => {
    expect(visitKeyOfIds(['klipp', 'vask'])).toBe(visitKey([klipp, vask]));
    expect(visitKeyOfIds(['klipp'])).toBe('klipp');
  });

  it('an empty list throws', () => {
    expect(() => visitOfServices([])).toThrow();
  });

  it('prices each service on its own', () => {
    const priceOf = (s: WizardService) => (s.id === 'vask' ? 11000 : 10000);
    expect(visitPriceOre([klipp, vask, skjegg], priceOf)).toBe(31000);
    expect(visitPriceOre([], priceOf)).toBe(0);
  });
});
