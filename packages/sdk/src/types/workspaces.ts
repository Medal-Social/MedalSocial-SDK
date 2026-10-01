/** A Medal Social workspace accessible to the authenticated credential. */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  [key: string]: unknown;
}
