import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { TFunction } from "i18next";

import { listStyles } from "@features/commissioning/pdfs/exports/listPdfBase";
import {
  ListPDFFooter,
  ListPDFHeader,
} from "@features/commissioning/pdfs/exports/ListPDFSharedComponents";

const localStyles = StyleSheet.create({
  colName: {
    width: "30%",
  },
  colSaturdays: {
    flex: 1,
  },
});

export interface SaturdayShiftsPDFRow {
  id: string;
  name: string;
  /** Formatted, in date order. */
  saturdays: { date: string; absent: boolean }[];
}

export interface SaturdayShiftsPDFProps {
  year: number;
  /** Every employee the page lists, in its order. */
  rows: SaturdayShiftsPDFRow[];
  t: TFunction;
}

/** One employee's Saturdays as a line of dates; one they are absent on says
 *  so in words, as the sheet may be printed in black and white. */
function saturdayList(row: SaturdayShiftsPDFRow, t: TFunction): string {
  if (row.saturdays.length === 0) return "–";
  return row.saturdays
    .map(({ date, absent }) =>
      absent ? `${date} (${t("staff.absent_mark")})` : date,
    )
    .join(", ");
}

/** The year's Saturday shifts: every employee, and the dates they work. */
const SaturdayShiftsPDF = ({ year, rows, t }: SaturdayShiftsPDFProps) => (
  <Document>
    <Page size="A4" style={listStyles.page}>
      <ListPDFHeader pill={t("staff.saturday_shifts")}>
        <Text style={listStyles.title}>
          {t("staff.saturday_shifts_pdf_title", { year })}
        </Text>
      </ListPDFHeader>

      <View>
        <View style={listStyles.tableHeader} fixed>
          <View style={[listStyles.compactCell, localStyles.colName]}>
            <Text>{t("staff.employee")}</Text>
          </View>
          <View style={[listStyles.compactCell, localStyles.colSaturdays]}>
            <Text>{t("staff.saturday_shifts")}</Text>
          </View>
        </View>

        {rows.map((row) => (
          <View key={row.id} style={listStyles.compactRow} wrap={false}>
            <View style={[listStyles.compactCell, localStyles.colName]}>
              <Text>{row.name}</Text>
            </View>
            <View style={[listStyles.compactCell, localStyles.colSaturdays]}>
              <Text>{saturdayList(row, t)}</Text>
            </View>
          </View>
        ))}
      </View>

      <ListPDFFooter t={t} />
    </Page>
  </Document>
);

export default SaturdayShiftsPDF;
