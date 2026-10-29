/**
 * `@medalsocial/ordering/core` — the framework-free rules behind a Medal
 * ordering site: money in øre, table and channel links, the cart draft, the
 * modifier rules, the cart check and checkout's details check (the Medal
 * API's own), the order status words, the hours engine (channel state and
 * slots, the Medal API's own), the allergen/dietary labels and the components' words
 * (`ORDERING_LABELS`, server-safe). No React, Next or
 * `server-only`; runs in a browser, Node or a Worker.
 */

export type {
  OrderingAllergen,
  OrderingChannel,
  OrderingCustomerOrder,
  OrderingDietary,
  OrderingLocation,
  OrderingLocations,
  OrderingMenu,
  OrderingMenuCategory,
  OrderingMenuItem,
  OrderingModifierGroup,
  OrderingModifierOption,
  OrderingOrderCreated,
  OrderingOrderLineInput,
  OrderingOrderStatus,
  OrderingOrderStatusView,
  OrderingPaymentMethod,
  OrderingSlot,
  OrderingSlots,
  OrderingTable,
} from '@medalsocial/sdk';
export {
  CART_LIMITS,
  type CartCheck,
  type CartLine,
  checkCart,
  type DroppedLine,
  type DroppedReason,
  type ResolvedCart,
  resolveCart,
  toOrderLine,
} from './cart';
export {
  CUSTOMER_LIMITS,
  type CustomerField,
  checkCustomer,
  isPhoneNumber,
  type OrderingRouteError,
  type OrderingRouteErrorCode,
  type PlaceOrderRequest,
} from './checkout';
export {
  fetchOrderStatus,
  type PlaceOrderOptions,
  placeOrder,
  type RouteResult,
} from './client';
export {
  type BuildOrderLinkInput,
  buildOrderLink,
  CHANNEL_QUERY_KEY,
  type OrderLink,
  type OrderLinkQuery,
  parseChannel,
  parseOrderLink,
  parseTable,
  TABLE_QUERY_KEY,
} from './deep-link';
export {
  createDraftStore,
  DRAFT_MAX_AGE_MS,
  DRAFT_VERSION,
  type DraftLine,
  type DraftLinePatch,
  type DraftStore,
  type DraftStoreOptions,
  draftStorageKey,
  MAX_DRAFT_LINES,
  MAX_NOTE_LENGTH,
  MAX_QUANTITY,
  type NewDraftLine,
  newIdempotencyKey,
  type OrderDraft,
} from './draft-store';
export { refusalMessage } from './errors';
export {
  addIsoDays,
  type Channel as EngineChannel,
  type ChannelReason,
  type ChannelState,
  channelState,
  DEFAULT_TIME_ZONE,
  type EngineInput,
  effectivePreorderDays,
  type HoursPeriod,
  type LocationHours,
  localIsoDate,
  type OrderingSettings,
  parsePeriods,
  prepMinutes,
  type SpecialDay,
  serviceDayEnd,
  slots,
  slotsForDate,
  type Window as HoursWindow,
} from './hours';
export { fromEngineChannel, toEngineChannel } from './hours-channel';
export {
  ALLERGEN_LABELS,
  allergenLabel,
  DIETARY_LABELS,
  deliveryWindowLabel,
  dietaryLabel,
  type LabelLocale,
  type LabelSet,
  labelLocale,
} from './labels';
export {
  linePriceOre,
  type SelectionFailure,
  type SelectionResult,
  type Selections,
  type SelectionsResult,
  selectionMode,
  unitPriceOre,
  validateSelection,
  validateSelections,
} from './modifiers';
export { createMoney, formatOre, type Money, type MoneyOptions } from './money';
export { openingLine } from './opening';
export {
  isFinalStatus,
  isUnsuccessfulStatus,
  ORDER_STATUS_LABELS,
  ORDER_STEPS,
  orderStatusLabel,
  orderStepIndex,
  STATUS_POLL_MS,
} from './status';
export { fill, mergeLabels, ORDERING_LABELS, type OrderingLabels } from './ui-labels';
