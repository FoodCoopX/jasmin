import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { TFunction } from "i18next";

import {
  organicStatusLabel,
  type OrganicStatus,
} from "@hooks/configuration/useOrganicGate";
import type {
  StationContentsCard,
  StationContentsPage,
} from "@features/commissioning/utils/stationContents";

import { listStyles } from "./listPdfBase";
import type { TenantInfo } from "./ListPDFSharedComponents";
import { pdfTheme } from "./pdfTheme";
import {
  KindChip,
  SizeBadge,
  StationSheetFooter,
  StationSheetHeader,
  StationSheetLegend,
  TickCircle,
  shareTint,
} from "./stationSheet";

const { colors } = pdfTheme;

// Two cards side by side across the A4 page's 515 pt between its margins.
const CARD_GAP = 12;
const CARD_WIDTH = 251;

const styles = StyleSheet.create({
  cards: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: CARD_GAP,
    rowGap: CARD_GAP,
    alignItems: "flex-start",
  },
  card: {
    width: CARD_WIDTH,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  cardTitleColumn: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: colors.text.primary,
  },
  articleCount: {
    fontSize: 8,
    color: colors.text.secondary,
  },
  lines: {
    paddingHorizontal: 10,
    paddingBottom: 4,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border.light,
  },
  lineLast: {
    borderBottomWidth: 0,
  },
  lineName: {
    flex: 1,
  },
  articleName: {
    fontSize: 11,
    color: colors.text.primary,
  },
  articleSize: {
    color: colors.text.muted,
  },
  note: {
    fontSize: 8.5,
    fontStyle: "italic",
    color: colors.text.secondary,
    marginTop: 1,
  },
  amount: {
    fontSize: 12,
    fontWeight: 700,
    color: colors.text.primary,
  },
  unit: {
    fontSize: 10,
    fontWeight: 400,
    color: colors.text.tertiary,
  },
  organicTag: {
    fontSize: 7.5,
    fontWeight: 700,
  },
  organicNote: {
    marginTop: 10,
    fontSize: 8.5,
    color: colors.text.secondary,
  },
});

const organicTagColor = (status: Exclude<OrganicStatus, "conventional">) =>
  status === "organic" ? colors.organic.organic : colors.organic.inConversion;

/** The EU 2018/848 disclosure for the organic marks on the page; nothing
 *  where the page carries none. */
function OrganicNote({ page, t }: { page: StationContentsPage; t: TFunction }) {
  const statuses = new Set(
    page.cards.flatMap((card) => card.lines.map((line) => line.organicStatus)),
  );
  const lines = [
    statuses.has("organic") &&
      `${organicStatusLabel(t, "organic")}: ${t("commissioning.organic.organic_footer")}, ${page.organicControlNumber}`,
    statuses.has("in_conversion") &&
      `${organicStatusLabel(t, "in_conversion")}: ${t("commissioning.organic.in_conversion_footer")}, ${page.organicControlNumber}`,
  ].filter((line): line is string => Boolean(line));
  if (lines.length === 0) return null;
  return (
    <View style={styles.organicNote} wrap={false}>
      {lines.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
    </View>
  );
}

function ShareCard({
  card,
  marksKind,
  t,
}: {
  card: StationContentsCard;
  marksKind: boolean;
  t: TFunction;
}) {
  return (
    <View style={styles.card} wrap={false}>
      <View
        style={[styles.cardHeader, { backgroundColor: shareTint(card.tint) }]}
      >
        {card.sizeLabel ? <SizeBadge label={card.sizeLabel} /> : null}
        <View style={styles.cardTitleColumn}>
          <Text style={styles.cardTitle}>{card.shareTypeName}</Text>
          <Text style={styles.articleCount}>
            {t("commissioning.station_contents.article_count", {
              count: card.lines.length,
            })}
          </Text>
        </View>
        {marksKind && (
          <KindChip
            loose={card.loose}
            label={
              card.loose
                ? t("commissioning.station_contents.take_yourself")
                : t("commissioning.station_contents.in_box")
            }
          />
        )}
      </View>
      <View style={styles.lines}>
        {card.lines.map((line, index) => (
          <View
            key={line.key}
            style={
              index === card.lines.length - 1
                ? [styles.line, styles.lineLast]
                : styles.line
            }
          >
            {card.loose && <TickCircle />}
            <View style={styles.lineName}>
              <Text style={styles.articleName}>
                {line.name}
                {line.sizeLabel && (
                  <Text
                    style={styles.articleSize}
                  >{` · ${line.sizeLabel}`}</Text>
                )}
                {line.sellerName && (
                  <Text
                    style={styles.articleSize}
                  >{` (${line.sellerName})`}</Text>
                )}
                {line.organicStatus && (
                  <Text
                    style={[
                      styles.organicTag,
                      { color: organicTagColor(line.organicStatus) },
                    ]}
                  >{`  ${organicStatusLabel(t, line.organicStatus)}`}</Text>
                )}
              </Text>
              {line.note ? <Text style={styles.note}>{line.note}</Text> : null}
            </View>
            <Text style={styles.amount}>
              {line.amount}
              {line.unit && <Text style={styles.unit}>{` ${line.unit}`}</Text>}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface StationContentsPDFProps {
  pages: StationContentsPage[];
  tenant: TenantInfo;
  t: TFunction;
}

/** The notice members read at their station: one page per station and
 *  delivery day, a card per share collected there. */
export default function StationContentsPDF({
  pages,
  tenant,
  t,
}: StationContentsPDFProps) {
  return (
    <Document>
      {pages.map((page) => (
        <Page key={page.key} size="A4" style={listStyles.page}>
          <StationSheetHeader
            pill={t("commissioning.station_contents.pill")}
            stationName={page.stationName}
            dateLabel={page.dateLabel}
            tenant={tenant}
          />
          {page.marksKind && (
            <StationSheetLegend
              boxed={
                page.cards.some((card) => !card.loose)
                  ? {
                      label: t("commissioning.station_contents.in_box"),
                      hint: t("commissioning.station_contents.in_box_hint"),
                    }
                  : null
              }
              loose={
                page.cards.some((card) => card.loose)
                  ? {
                      label: t("commissioning.station_contents.take_yourself"),
                      hint: t(
                        "commissioning.station_contents.take_yourself_hint",
                      ),
                    }
                  : null
              }
            />
          )}
          <View style={styles.cards}>
            {page.cards.map((card) => (
              <ShareCard
                key={card.key}
                card={card}
                marksKind={page.marksKind}
                t={t}
              />
            ))}
          </View>
          <OrganicNote page={page} t={t} />
          <StationSheetFooter
            question={t("commissioning.station_contents.missing")}
            tenant={tenant}
            t={t}
          />
        </Page>
      ))}
    </Document>
  );
}
