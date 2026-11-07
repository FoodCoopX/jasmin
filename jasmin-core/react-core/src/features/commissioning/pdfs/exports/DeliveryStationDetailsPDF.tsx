import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { TFunction } from "i18next";

import type {
  PackingBoxesMatrixColumn,
  PackingModeEnum,
} from "@shared/api/generated/models";
import { getShareTypeVariationSizeLabelPure } from "@hooks/useShareTypeVariationSizeOptions";
import { getShareSizeLabelOrEmpty } from "@features/commissioning/utils/sizeLabel";
import {
  isPackedLoose,
  marksPackingKind,
} from "@features/commissioning/utils/stationContents";

import {
  comboColumnWidth,
  formatComboCount,
  groupComboColumns,
  pickComboOrientation,
  type PdfOrientation,
} from "./boxComboPdf";
import { listStyles } from "./listPdfBase";
import type { TenantInfo } from "./ListPDFSharedComponents";
import { pdfTheme } from "./pdfTheme";
import {
  KindChip,
  ShareIcon,
  SizeBadge,
  StationSheetFooter,
  StationSheetHeader,
  StationSheetLegend,
  TickCircle,
  shareTint,
} from "./stationSheet";

// Re-exported so ``DeliveryStationDetailsPDFGenerator`` keeps importing the
// tenant-info shape from here; it's the shared ``ListPDFSharedComponents`` type.
export type { TenantInfo };

const { colors } = pdfTheme;

// Fixed pt widths; the member-name column takes the rest.
const LETTER_WIDTH = 16;
const TICK_WIDTH = 40;
const NAME_MIN_WIDTH = 130;
const FIXED_WIDTH = LETTER_WIDTH + TICK_WIDTH;
// Below this a column shows the crate or basket without its word.
const CHIP_LABEL_MIN_WIDTH = 50;

const styles = StyleSheet.create({
  table: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  groupCell: {
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 700,
    color: colors.text.primary,
  },
  columnHeaderRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: 1.5,
    borderBottomColor: colors.text.primary,
  },
  columnHeader: {
    paddingVertical: 5,
    paddingHorizontal: 2,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 3,
  },
  headerLabel: {
    fontSize: 8,
    fontWeight: 700,
    color: colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  oneSize: {
    height: 24,
    justifyContent: "center",
    fontSize: 8,
    fontWeight: 700,
    color: colors.text.tertiary,
  },
  addOn: {
    fontSize: 7,
    color: colors.text.secondary,
    textAlign: "center",
  },
  iconChip: {
    padding: 2,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.page,
  },
  iconChipLoose: {
    backgroundColor: colors.brand,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 24,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border.light,
  },
  memberRowAlt: {
    backgroundColor: colors.rowAlt,
  },
  letter: {
    width: LETTER_WIDTH,
    paddingLeft: 5,
    fontSize: 9,
    fontWeight: 700,
    color: colors.brand,
  },
  name: {
    flex: 1,
    minWidth: NAME_MIN_WIDTH,
    paddingVertical: 4,
    paddingHorizontal: 5,
    fontSize: 11,
    fontWeight: 500,
  },
  count: {
    textAlign: "center",
    fontSize: 13,
    fontWeight: 700,
  },
  tickCell: {
    width: TICK_WIDTH,
    alignItems: "center",
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 22,
    backgroundColor: colors.brandSurface,
  },
  totalLabel: {
    flex: 1,
    minWidth: NAME_MIN_WIDTH,
    paddingHorizontal: 5,
    fontSize: 9,
    fontWeight: 700,
    color: colors.text.tertiary,
  },
  totalCount: {
    textAlign: "center",
    fontSize: 10,
    fontWeight: 700,
    color: colors.text.tertiary,
  },
});

interface MemberRow {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface StationPageData {
  stationName: string;
  /** The delivery day as the page heads it; see ``useStationSheetLabels``. */
  dateLabel: string;
  // Each station has its OWN box-combination columns (different members ⇒
  // different combinations), so the columns travel with the page, not shared.
  columns: PackingBoxesMatrixColumn[];
  rows: MemberRow[];
}

export interface DeliveryStationDetailsPDFProps {
  pages: StationPageData[];
  packingMode: PackingModeEnum;
  /** Each share type's tint; see ``useStationSheetLabels``. */
  tints: Record<string, number>;
  tenant: TenantInfo;
  t: TFunction;
}

/** A combination lies loose when its base does; one without a base, when all
 *  its add-ons do. */
function combinationIsLoose(
  column: PackingBoxesMatrixColumn,
  packingMode: PackingModeEnum,
): boolean {
  if (column.base_variation_id) {
    return isPackedLoose(column.base_is_packed_bulk, packingMode);
  }
  return (
    column.add_ons.length > 0 &&
    column.add_ons.every((addOn) =>
      isPackedLoose(addOn.is_packed_bulk, packingMode),
    )
  );
}

const sizeLabel = (size: string, t: TFunction) =>
  getShareSizeLabelOrEmpty(size, (code) =>
    getShareTypeVariationSizeLabelPure(code, t),
  );

function ColumnHeader({
  column,
  loose,
  width,
  tint,
  packingMode,
  t,
}: {
  column: PackingBoxesMatrixColumn;
  loose: boolean;
  width: number;
  tint: string;
  packingMode: PackingModeEnum;
  t: TFunction;
}) {
  const marksKind = marksPackingKind(packingMode);
  const baseSize = sizeLabel(column.base_size, t);
  const kindLabel = loose
    ? t("commissioning.pickup_sheet.loose_chip")
    : t("commissioning.pickup_sheet.box_chip");
  return (
    <View style={[styles.columnHeader, { width, backgroundColor: tint }]}>
      {baseSize ? (
        <SizeBadge label={baseSize} />
      ) : (
        <Text style={styles.oneSize}>
          {column.base_variation_id
            ? t("commissioning.pickup_sheet.one_size")
            : "—"}
        </Text>
      )}
      {column.add_ons.map((addOn) => {
        const addOnSize = sizeLabel(addOn.size, t);
        // An add-on that lies loose beside a boxed base says so itself.
        const addOnLoose =
          marksKind &&
          !loose &&
          isPackedLoose(addOn.is_packed_bulk, packingMode);
        return (
          <Text key={addOn.variation_id} style={styles.addOn}>
            {`+ ${addOn.share_type_short_name}${addOnSize ? ` ${addOnSize}` : ""}${
              addOnLoose
                ? ` · ${t("commissioning.pickup_sheet.loose_chip")}`
                : ""
            }`}
          </Text>
        );
      })}
      {marksKind &&
        (width >= CHIP_LABEL_MIN_WIDTH ? (
          <KindChip loose={loose} label={kindLabel} />
        ) : (
          <View
            style={
              loose ? [styles.iconChip, styles.iconChipLoose] : styles.iconChip
            }
          >
            <ShareIcon
              loose={loose}
              color={loose ? colors.page : colors.brand}
            />
          </View>
        ))}
    </View>
  );
}

function StationPage({
  page,
  orientation,
  packingMode,
  tints,
  tenant,
  t,
}: {
  page: StationPageData;
  orientation: PdfOrientation;
  packingMode: PackingModeEnum;
  tints: Record<string, number>;
  tenant: TenantInfo;
  t: TFunction;
}) {
  const { columns, rows } = page;
  const groups = groupComboColumns(columns, t);
  const comboWidth = comboColumnWidth({
    orientation,
    comboCount: columns.length,
    fixedWidth: FIXED_WIDTH,
    flexMinWidth: NAME_MIN_WIDTH,
  });
  const groupTint = (groupId: string) =>
    groupId in tints ? shareTint(tints[groupId]) : colors.tableHeader;
  const looseByKey = new Map(
    columns.map((column) => [
      column.key,
      combinationIsLoose(column, packingMode),
    ]),
  );
  const looseKinds = [...looseByKey.values()];

  // The first member of each initial carries the letter, so a member finds
  // their name by its first letter.
  const initials = rows.map((member, index) => {
    const initial = (member.name ?? "").charAt(0).toUpperCase();
    const previous = (rows[index - 1]?.name ?? "").charAt(0).toUpperCase();
    return index === 0 || initial !== previous ? initial : "";
  });

  return (
    <Page size="A4" orientation={orientation} style={listStyles.page}>
      <StationSheetHeader
        pill={t("commissioning.pickup_sheet.pill")}
        stationName={page.stationName}
        dateLabel={page.dateLabel}
        tenant={tenant}
      />
      {marksPackingKind(packingMode) && (
        <StationSheetLegend
          boxed={
            looseKinds.includes(false)
              ? {
                  label: t("commissioning.pickup_sheet.box"),
                  hint: t("commissioning.pickup_sheet.box_hint"),
                }
              : null
          }
          loose={
            looseKinds.includes(true)
              ? {
                  label: t("commissioning.pickup_sheet.loose"),
                  hint: t("commissioning.pickup_sheet.loose_hint"),
                }
              : null
          }
        />
      )}

      <View style={styles.table}>
        {/* Both header rows repeat on every page the list runs over. */}
        <View style={styles.row} fixed>
          <View style={{ width: LETTER_WIDTH }} />
          <View style={styles.name} />
          {groups.map((group) => (
            <View
              key={group.id}
              style={[
                styles.groupCell,
                {
                  width: comboWidth * group.cols.length,
                  backgroundColor: groupTint(group.id),
                },
              ]}
            >
              <Text>{group.name}</Text>
            </View>
          ))}
          <View style={{ width: TICK_WIDTH }} />
        </View>
        <View style={styles.columnHeaderRow} fixed>
          <View style={{ width: LETTER_WIDTH }} />
          <View style={[styles.name, { justifyContent: "flex-end" }]}>
            <Text style={styles.headerLabel}>
              {t("commissioning.pickup_sheet.find_your_name")}
            </Text>
          </View>
          {groups.flatMap((group) =>
            group.cols.map((column) => (
              <ColumnHeader
                key={column.key}
                column={column}
                loose={looseByKey.get(column.key) ?? false}
                width={comboWidth}
                tint={groupTint(group.id)}
                packingMode={packingMode}
                t={t}
              />
            )),
          )}
          <View style={[styles.tickCell, { justifyContent: "flex-end" }]}>
            <Text style={styles.headerLabel}>
              {t("commissioning.pickup_sheet.collected")}
            </Text>
          </View>
        </View>

        {rows.map((member, index) => (
          <View
            key={member.id || index}
            style={
              index % 2
                ? [styles.memberRow, styles.memberRowAlt]
                : styles.memberRow
            }
            wrap={false}
          >
            <Text style={styles.letter}>{initials[index]}</Text>
            <Text style={styles.name}>{member.name || "-"}</Text>
            {columns.map((column) => (
              <Text
                key={column.key}
                style={[styles.count, { width: comboWidth }]}
              >
                {formatComboCount(member[column.key])}
              </Text>
            ))}
            <View style={styles.tickCell}>
              <TickCircle />
            </View>
          </View>
        ))}

        <View style={styles.totalRow} wrap={false}>
          <View style={{ width: LETTER_WIDTH }} />
          <Text style={styles.totalLabel}>
            {t("commissioning.pickup_sheet.total")}
          </Text>
          {columns.map((column) => (
            <Text
              key={column.key}
              style={[styles.totalCount, { width: comboWidth }]}
            >
              {formatComboCount(column.count)}
            </Text>
          ))}
          <View style={{ width: TICK_WIDTH }} />
        </View>
      </View>

      <StationSheetFooter
        question={t("commissioning.pickup_sheet.missing")}
        tenant={tenant}
        t={t}
      />
    </Page>
  );
}

/** The pickup lists printed for the stations: one page per station and
 *  delivery day, a row per member with the boxes of each combination. */
export default function DeliveryStationDetailsPDF({
  pages,
  packingMode,
  tints,
  tenant,
  t,
}: DeliveryStationDetailsPDFProps) {
  // One orientation for the whole document, chosen from the widest station page.
  const maxComboCount = pages.reduce(
    (max, page) => Math.max(max, page.columns.length),
    0,
  );
  const orientation = pickComboOrientation({
    maxComboCount,
    fixedWidth: FIXED_WIDTH,
    flexMinWidth: NAME_MIN_WIDTH,
  });

  return (
    <Document>
      {pages.map((page, index) => (
        <StationPage
          key={index}
          page={page}
          orientation={orientation}
          packingMode={packingMode}
          tints={tints}
          tenant={tenant}
          t={t}
        />
      ))}
    </Document>
  );
}
