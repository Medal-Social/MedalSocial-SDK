/**
 * `@medalsocial/ordering/core` — the framework-free rules behind a Medal
 * ordering site: money in øre, table and channel links, the cart draft, the
 * modifier rules, the hours engine (channel state and slots, the Medal API's
 * own), the allergen/dietary labels and the components' words
 * (`ORDERING_LABELS`, server-safe). No React, Next or
 * `server-only`; runs in a browser, Node or a Worker.
 */

export type {
  OrderingAllergen,
  OrderingChannel,
  OrderingDietary,
  OrderingMenu,
  OrderingMenuCategory,
  OrderingMenuItem,
  OrderingModifierGroup,
  OrderingModifierOption,
} from '@medalsocial/sdk';
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
export {
  addIsoDays,
  type Channel,
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
  type Window,
} from './hours';
export { fromEngineChannel, toEngineChannel } from './hours-channel';
export {
  ALLERGEN_LABELS,
  allergenLabel,
  DIETARY_LABELS,
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
export { fill, mergeLabels, ORDERING_LABELS, type OrderingLabels } from './ui-labels';
