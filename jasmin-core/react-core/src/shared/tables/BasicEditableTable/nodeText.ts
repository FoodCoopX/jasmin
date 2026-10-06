import { isValidElement, type ReactNode } from "react";

/**
 * The plain text of a node: a column title, for an input's accessible name and
 * the field names in a save error, or a select option's label, for searching.
 * Both are often wrapped — `<>{t(...)}</>`, or a span holding the text and an
 * icon or a status dot — so the text is read out of the element tree; an
 * element without text children, like the icon, adds nothing.
 */
export function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(nodeText).join("").trim();
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children).trim();
  }
  return "";
}
