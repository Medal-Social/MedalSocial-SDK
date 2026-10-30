/**
 * `@medalsocial/ordering/react` — the menu list, the dish sheet, the cart
 * bar and list, checkout (with delivery's address field), the order status
 * and the closed notice, composed
 * on `/core`. Client components; presentational and controlled through
 * props — fetching, the cart draft and navigation are the page's.
 *
 * Styled with Tailwind v4 classes on the shadcn/meda colour tokens
 * (`bg-background`, `bg-primary`, `text-muted-foreground`, …), so a site's own
 * theme variables restyle them. A site adds an `@source` for this package
 * (see the README).
 */

export type { OrderingLabels } from '../core/ui-labels';
export { AddressCombobox, type AddressComboboxProps } from './AddressCombobox';
export { CartBar, type CartBarProps } from './CartBar';
export { CartList, type CartListProps } from './CartList';
export { Checkout, type CheckoutDetails, type CheckoutProps } from './Checkout';
export { ClosedNotice, type ClosedNoticeProps } from './ClosedNotice';
export { ItemSheet, type ItemSheetLine, type ItemSheetProps } from './ItemSheet';
export { MenuList, type MenuListProps } from './MenuList';
export { OrderStatus, type OrderStatusProps } from './OrderStatus';
