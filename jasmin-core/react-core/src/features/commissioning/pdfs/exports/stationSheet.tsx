/* eslint-disable react-refresh/only-export-components --
   react-pdf renders the documents built from these blocks to a file on
   demand, not into the page, so there is no mounted component for Fast
   Refresh to keep. */
import { Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { TFunction } from "i18next";

import { ListPDFHeader, type TenantInfo } from "./ListPDFSharedComponents";
import { pdfTheme } from "./pdfTheme";

/**
 * The parts the two sheets printed for a delivery station share — the
 * members' notice and the pickup list — so a member finds the same header,
 * icons, colours and size badges on both.
 */

const { colors } = pdfTheme;

// Outlines of the two share icons on a 24-unit grid: a crate for a share
// packed in a box, a basket for a loose one.
const CRATE_ICON_PATHS = ["M3 9h18v11H3z", "M2 5h20v4H2z", "M9 13h6"];
const BASKET_ICON_PATHS = [
  "M3 10h18l-2 10H5z",
  "M7 10l5-6 5 6",
  "M9 14v3",
  "M15 14v3",
];

export const stationSheetStyles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: colors.text.primary,
    marginBottom: 3,
  },
  dateLine: {
    fontSize: 12,
    color: colors.text.tertiary,
  },
  legend: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  legendEntry: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.brandSurface,
  },
  legendEntryLoose: {
    backgroundColor: colors.brand,
  },
  legendText: {
    flex: 1,
    fontSize: 9.5,
    color: colors.text.primary,
  },
  legendTextLoose: {
    color: colors.page,
  },
  legendLabel: {
    fontWeight: 700,
  },
  sizeBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 4,
    borderWidth: 1.2,
    borderColor: colors.text.primary,
    borderRadius: 5,
    backgroundColor: colors.page,
    alignItems: "center",
    justifyContent: "center",
  },
  sizeBadgeText: {
    fontSize: 13,
    fontWeight: 700,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.page,
  },
  chipLoose: {
    backgroundColor: colors.brand,
  },
  chipText: {
    fontSize: 8,
    fontWeight: 700,
    color: colors.brand,
  },
  chipTextLoose: {
    color: colors.page,
  },
  tick: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1,
    borderColor: colors.text.tertiary,
  },
  footer: {
    position: "absolute",
    bottom: 26,
    left: pdfTheme.spacing.page,
    right: pdfTheme.spacing.page,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: colors.border.default,
    fontSize: 9,
    color: colors.text.secondary,
  },
  footerQuestion: {
    fontWeight: 700,
    color: colors.text.primary,
  },
});

/** The band colour of a share type; see ``useStationSheetLabels``. */
export const shareTint = (tint: number): string =>
  colors.shareTints[tint % colors.shareTints.length];

export function ShareIcon({
  loose,
  color,
  size = 11,
}: {
  loose: boolean;
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {(loose ? BASKET_ICON_PATHS : CRATE_ICON_PATHS).map((path) => (
        <Path
          key={path}
          d={path}
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}

/** Station and date under a pill naming the sheet, the farm's logo and name
 *  beside them. The contact goes in the footer, beside what it is for. */
export function StationSheetHeader({
  pill,
  stationName,
  dateLabel,
  tenant,
}: {
  pill: string;
  stationName: string;
  dateLabel: string;
  tenant: TenantInfo;
}) {
  return (
    <ListPDFHeader
      tenant={{ name: tenant.name, logoUrl: tenant.logoUrl }}
      pill={pill}
    >
      <Text style={stationSheetStyles.title}>{stationName}</Text>
      <Text style={stationSheetStyles.dateLine}>{dateLabel}</Text>
    </ListPDFHeader>
  );
}

interface LegendEntry {
  label: string;
  hint: string;
}

/** What the crate and the basket mean, for the kinds of share on the page. */
export function StationSheetLegend({
  boxed,
  loose,
}: {
  boxed: LegendEntry | null;
  loose: LegendEntry | null;
}) {
  return (
    <View style={stationSheetStyles.legend}>
      {boxed && (
        <View style={stationSheetStyles.legendEntry}>
          <ShareIcon loose={false} color={colors.brand} />
          <Text style={stationSheetStyles.legendText}>
            <Text style={stationSheetStyles.legendLabel}>{boxed.label}</Text>
            {` – ${boxed.hint}`}
          </Text>
        </View>
      )}
      {loose && (
        <View
          style={[
            stationSheetStyles.legendEntry,
            stationSheetStyles.legendEntryLoose,
          ]}
        >
          <ShareIcon loose color={colors.page} />
          <Text
            style={[
              stationSheetStyles.legendText,
              stationSheetStyles.legendTextLoose,
            ]}
          >
            <Text style={stationSheetStyles.legendLabel}>{loose.label}</Text>
            {` – ${loose.hint}`}
          </Text>
        </View>
      )}
    </View>
  );
}

/** A share's size in a framed square, as members find it on their box. */
export function SizeBadge({ label }: { label: string }) {
  return (
    <View style={stationSheetStyles.sizeBadge}>
      <Text style={stationSheetStyles.sizeBadgeText}>{label}</Text>
    </View>
  );
}

/** Whether a share is boxed or loose: outlined crate, or filled basket. */
export function KindChip({ loose, label }: { loose: boolean; label: string }) {
  return (
    <View
      style={
        loose
          ? [stationSheetStyles.chip, stationSheetStyles.chipLoose]
          : stationSheetStyles.chip
      }
    >
      <ShareIcon loose={loose} color={loose ? colors.page : colors.brand} />
      <Text
        style={
          loose
            ? [stationSheetStyles.chipText, stationSheetStyles.chipTextLoose]
            : stationSheetStyles.chipText
        }
      >
        {label}
      </Text>
    </View>
  );
}

/** An empty circle to tick on the printed sheet. */
export function TickCircle() {
  return <View style={stationSheetStyles.tick} />;
}

/** Whom to tell when something is wrong; left out without a phone number or
 *  email address to give. */
export function StationSheetFooter({
  question,
  tenant,
  t,
}: {
  question: string;
  tenant: TenantInfo;
  t: TFunction;
}) {
  const contact = [tenant.phone, tenant.email].filter(Boolean).join(" · ");
  if (!contact) return null;
  return (
    <View style={stationSheetStyles.footer} fixed>
      <Text>
        <Text style={stationSheetStyles.footerQuestion}>{question}</Text>
        {` ${t("commissioning.station_contents.contact")} ${contact}`}
      </Text>
    </View>
  );
}
