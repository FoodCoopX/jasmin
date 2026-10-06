import { Modal } from "antd";
import dayjs from "dayjs";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDateFormat } from "@hooks/index";
import { sameCellValue } from "@shared/tables";
import { WEEKDAY_KEYS } from "@shared/utils/weekdayNames";

interface StationDay {
  delivery_day?: unknown;
  valid_from?: unknown;
  valid_until?: unknown;
}

interface DeliveryDay {
  id?: unknown;
  day_number?: unknown;
}

/**
 * Asks the office before a new station day takes over its delivery day's open
 * one — the backend then ends that one the day before the new one starts and
 * moves its later deliveries and reservations over. `confirmTakeover` resolves
 * to true when the new day takes nothing over or the office agrees; render
 * `confirmHolder` for the question to show.
 */
export function useStationDayTakeover(
  stationDays: StationDay[],
  deliveryDays: DeliveryDay[],
) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const [modal, confirmHolder] = Modal.useModal();

  const confirmTakeover = useCallback(
    async (newDay: Record<string, unknown>): Promise<boolean> => {
      const from = String(newDay.valid_from ?? "");
      const replaced = stationDays.find(
        (day) =>
          sameCellValue(day.delivery_day, newDay.delivery_day) &&
          !day.valid_until &&
          String(day.valid_from) < from,
      );
      if (!replaced) return true;
      const dayNumber = deliveryDays.find((day) =>
        sameCellValue(day.id, newDay.delivery_day),
      )?.day_number;
      return modal.confirm({
        title: t("delivery_stations.takeover_title"),
        content: t("delivery_stations.takeover_text", {
          weekday:
            typeof dayNumber === "number" ? t(WEEKDAY_KEYS[dayNumber]) : "",
          since: formatDate(replaced.valid_from as string),
          from: formatDate(from),
          until: formatDate(dayjs(from).subtract(1, "day")),
        }),
        okText: t("delivery_stations.takeover_confirm"),
        cancelText: t("common.cancel"),
      });
    },
    [stationDays, deliveryDays, modal, t, formatDate],
  );

  return { confirmTakeover, confirmHolder };
}
