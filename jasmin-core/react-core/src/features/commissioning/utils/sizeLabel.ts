/** A share's size label, or "" for a share type that comes in one size. */
export function getShareSizeLabelOrEmpty(
  size: string | null | undefined,
  getShareTypeVariationSizeLabel: (size: string) => string,
): string {
  return size && size !== "ONE_SIZE"
    ? getShareTypeVariationSizeLabel(size)
    : "";
}

/** The size label to append to an article's name, or "" for the default size M. */
export function getSizeLabelOrEmpty(
  size: string | null | undefined,
  getVegetableSizeLabel: (size: string) => string,
): string {
  return size && size !== "M" ? getVegetableSizeLabel(size) : "";
}
