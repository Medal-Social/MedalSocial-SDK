/**
 * `@medalsocial/ordering/react` — the menu list, the dish sheet and the
 * closed notice, composed on `/core`. Client components; presentational and
 * controlled through props — fetching the menu, the cart and checkout are the
 * page's.
 *
 * Styled with Tailwind v4 classes on the shadcn/meda colour tokens
 * (`bg-background`, `bg-primary`, `text-muted-foreground`, …), so a site's own
 * theme variables restyle them. A site adds an `@source` for this package
 * (see the README).
 */

export { ClosedNotice, type ClosedNoticeProps } from './ClosedNotice';
export { ItemSheet, type ItemSheetLine, type ItemSheetProps } from './ItemSheet';
export { mergeLabels, ORDERING_LABELS, type OrderingLabels } from './labels';
export { MenuList, type MenuListProps } from './MenuList';
