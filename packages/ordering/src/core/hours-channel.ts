/**
 * The wire channel (`dine_in`, as in `?c=` and the API's JSON) and the hours
 * engine's own name for it (`dineIn`, as in the API's ordering settings).
 */
import type { OrderingChannel } from '@medalsocial/sdk';
import type { Channel } from './hours';

const ENGINE_CHANNEL: Readonly<Record<OrderingChannel, Channel>> = {
  dine_in: 'dineIn',
  takeaway: 'takeaway',
  delivery: 'delivery',
};

const WIRE_CHANNEL = Object.fromEntries(
  Object.entries(ENGINE_CHANNEL).map(([wire, engine]) => [engine, wire])
) as Readonly<Record<Channel, OrderingChannel>>;

/** `dine_in` → `dineIn`, for `channelState` / `slots`. */
export function toEngineChannel(channel: OrderingChannel): Channel {
  return ENGINE_CHANNEL[channel];
}

/** `dineIn` → `dine_in`, for a link or a request. */
export function fromEngineChannel(channel: Channel): OrderingChannel {
  return WIRE_CHANNEL[channel];
}
