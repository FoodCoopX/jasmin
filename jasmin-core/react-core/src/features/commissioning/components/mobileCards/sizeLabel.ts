/** The size label for a card's suffix, or "" for the default size M. */
export function getSizeLabelOrEmpty(
  size: string | null | undefined,
  getVegetableSizeLabel: (size: string) => string,
): string {
  return size && size !== "M" ? getVegetableSizeLabel(size) : "";
}
