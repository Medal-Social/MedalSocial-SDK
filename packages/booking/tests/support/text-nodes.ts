/**
 * An element's children as the browser lays them out: each text node's text,
 * and `<tag>` for a child element. A filled label rendered as one string is
 * one text node; the same sentence written as JSX `{a}{b}` is several, and
 * Chrome positions glyphs per text node, so the two can differ by a sub-pixel.
 */
export function textNodesOf(element: Element): string[] {
  return Array.from(element.childNodes, (node) =>
    node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '') : `<${node.nodeName.toLowerCase()}>`
  );
}
