import type {
  PackingModeEnum,
  StationContentsShare,
} from "@shared/api/generated/models";
import type { OrganicStatus } from "@hooks/configuration/useOrganicGate";
import { formatMemberAmount } from "@shared/utils";
import { getShareSizeLabelOrEmpty, getSizeLabelOrEmpty } from "./sizeLabel";

export interface StationContentsLine {
  key: string;
  name: string;
  /** The article's size, or "" for the default size. */
  sizeLabel: string;
  amount: string;
  unit: string;
  note: string;
  /** The name the seller shows members, where the farm shows sellers. */
  sellerName: string;
  /** Organic or in conversion where the farm is certified to say so; see
   *  ``useOrganicGate``. */
  organicStatus: Exclude<OrganicStatus, "conventional"> | null;
}

export interface StationContentsCard {
  key: string;
  shareTypeName: string;
  /** The share's size, or "" for a share type that comes in one size. */
  sizeLabel: string;
  /** Lies loose at the station, for members to take themselves. */
  loose: boolean;
  /** Picks the card's tint; see ``useStationSheetLabels``. */
  tint: number;
  lines: StationContentsLine[];
}

/** The notice for one station on one delivery day. */
export interface StationContentsPage {
  key: string;
  stationName: string;
  dateLabel: string;
  /** Whether the cards say boxed or loose; see ``marksPackingKind``. */
  marksKind: boolean;
  /** The farm's organic control number, "" where it isn't certified. */
  organicControlNumber: string;
  cards: StationContentsCard[];
}

interface CardLabels {
  packingMode: PackingModeEnum;
  tints: Record<string, number>;
  /** Whether the farm is certified to mark articles organic. */
  marksOrganic: boolean;
  /** Whether members see who sold a bought-in article. */
  showsSellers: boolean;
  /** The article's name as members read it. */
  articleName: (name: string) => string;
  shareSizeLabel: (size: string) => string;
  articleSizeLabel: (size: string) => string;
  unitLabel: (unit: string) => string;
  format: (value: number, decimals: number) => string;
}

/** Whether the station sheets say which shares are boxed and which loose:
 *  only where the farm packs both ways, as otherwise every share is the same. */
export const marksPackingKind = (packingMode: PackingModeEnum): boolean =>
  packingMode === "MIXED";

/** Whether a share lies loose at the station: in BULK mode every share does,
 *  in BOXES mode none; in MIXED mode its variation's ``is_packed_bulk``
 *  decides. */
export const isPackedLoose = (
  isPackedBulk: boolean,
  packingMode: PackingModeEnum,
): boolean =>
  packingMode === "BULK" || (packingMode === "MIXED" && isPackedBulk);

/** One card per share, in the order the station contents list them. */
export function buildStationContentsCards(
  shares: StationContentsShare[],
  labels: CardLabels,
): StationContentsCard[] {
  return shares.map((share) => ({
    key: share.variation_id,
    shareTypeName: share.share_type_name,
    sizeLabel: getShareSizeLabelOrEmpty(share.size, labels.shareSizeLabel),
    loose: isPackedLoose(share.is_packed_bulk, labels.packingMode),
    tint: labels.tints[share.share_type_id] ?? 0,
    lines: share.items.map((item) => {
      const { amount, unit } = formatMemberAmount(
        Number(item.amount),
        item.unit,
        labels.format,
      );
      return {
        key: item.id,
        name: labels.articleName(item.share_article_name),
        sizeLabel: getSizeLabelOrEmpty(item.size, labels.articleSizeLabel),
        amount,
        unit: unit ? labels.unitLabel(unit) : "",
        note: item.note,
        sellerName: labels.showsSellers
          ? item.seller_name_for_member_pages
          : "",
        organicStatus:
          labels.marksOrganic && item.organic_status !== "conventional"
            ? item.organic_status
            : null,
      };
    }),
  }));
}
