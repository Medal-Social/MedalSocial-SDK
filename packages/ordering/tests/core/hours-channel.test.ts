import { describe, expect, it } from 'vitest';
import { fromEngineChannel, toEngineChannel } from '../../src/core/hours-channel';
import { parseChannel } from '../../src/core/index';

describe('the wire channel and the hours engine channel', () => {
  it('maps every wire channel to the engine', () => {
    expect(toEngineChannel('dine_in')).toBe('dineIn');
    expect(toEngineChannel('takeaway')).toBe('takeaway');
    expect(toEngineChannel('delivery')).toBe('delivery');
  });

  it('maps every engine channel back to the wire', () => {
    expect(fromEngineChannel('dineIn')).toBe('dine_in');
    expect(fromEngineChannel('takeaway')).toBe('takeaway');
    expect(fromEngineChannel('delivery')).toBe('delivery');
  });

  it('round-trips a channel read from a link', () => {
    const channel = parseChannel('DINE_IN');
    expect(channel).toBe('dine_in');
    expect(fromEngineChannel(toEngineChannel(channel ?? 'takeaway'))).toBe('dine_in');
  });

  it('is exported from /core with the engine', async () => {
    const core = await import('../../src/core/index');
    expect(core.toEngineChannel).toBe(toEngineChannel);
    expect(core.fromEngineChannel).toBe(fromEngineChannel);
    for (const name of [
      'channelState',
      'slots',
      'slotsForDate',
      'serviceDayEnd',
      'parsePeriods',
      'prepMinutes',
      'effectivePreorderDays',
      'localIsoDate',
      'addIsoDays',
    ]) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe('function');
    }
    expect(core.DEFAULT_TIME_ZONE).toBe('Europe/Oslo');
  });
});
