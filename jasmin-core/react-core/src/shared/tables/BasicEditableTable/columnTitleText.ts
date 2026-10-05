import { isValidElement, type ReactNode } from "react";

/**
 * The plain text of a column title, for an input's accessible name and the
 * field names in a save error. Titles are often wrapped — `<>{t(...)}</>`, or
 * a span holding the text and a tooltip icon — so the text is read out of the
 * element tree; an element without text children, like the icon, adds nothing.
 */
export function columnTitleText(title: ReactNode): string {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  if (Array.isArray(title)) {
    return title.map(columnTitleText).join("").trim();
  }
  if (isValidElement<{ children?: ReactNode }>(title)) {
    return columnTitleText(title.props.children).trim();
  }
  return "";
}
