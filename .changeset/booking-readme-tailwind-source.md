---
'@medalsocial/booking': patch
---

README: a site's stylesheet needs `@source` for the package's `dist/react`. Tailwind does not scan `node_modules`, so without it the classes only this package uses (the desktop panel's column grid) are never generated.
