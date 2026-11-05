import { activeAtDateForWeek } from "@shared/utils";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShareDeliveryDays } from '@features/commissioning/hooks';
import type { CommissioningSharesDeliveryDaysListParams } from "@shared/api/generated/models";
import BaseEntitySelector, { type SelectorOption } from "@shared/selectors/BaseEntitySelector";

type TourValue = number | "all";

interface TourSelectorProps {
  selectedTour: TourValue | null;
  /** Gets `null` when the chosen day lists no tours, so no stale tour stays picked. */
  setSelectedTour: (value: TourValue | null) => void;
  onTourChange?: ((value: TourValue | null) => void) | null;
  include_null_option?: boolean;
  preserveSelection?: boolean;
  delivery_day?: string | null;
  selectedYear?: number | null;
  selectedWeek?: number | null;
}

const TourSelector = ({
  selectedTour,
  setSelectedTour,
  onTourChange = null,
  include_null_option = false,
  preserveSelection = true,
  delivery_day = null,
  selectedYear = null,
  selectedWeek = null,
}: TourSelectorProps) => {
  const { t } = useTranslation();

  const activeAtDate = useMemo(() => {
    if (!selectedYear || !selectedWeek) return null;
    return activeAtDateForWeek(selectedYear, selectedWeek);
  }, [selectedYear, selectedWeek]);

  // The list carries a day's tours only for a week's date, so without a full
  // year and week the selector has no tour to offer.
  const tourFilters = useMemo<CommissioningSharesDeliveryDaysListParams>(
    () =>
      activeAtDate
        ? { active_at_date: activeAtDate, need_info_on_tours: true }
        : {},
    [activeAtDate],
  );

  const { shareDeliveryDays, loading } = useShareDeliveryDays(tourFilters);

  // The tours the day's stations sit on that week, which need not start at 1.
  const dayTours = useMemo<number[]>(() => {
    if (delivery_day === null) return [];
    const record = shareDeliveryDays.find((day) => day.id === delivery_day);
    return [...(record?.used_tours ?? [])].sort((a, b) => a - b);
  }, [shareDeliveryDays, delivery_day]);

  const options = useMemo<SelectorOption<TourValue | null>[]>(() => {
    if (dayTours.length === 0) return [];
    const tours: SelectorOption<TourValue | null>[] = dayTours.map((tour) => ({
      value: tour,
      label: t("commissioning.tour_number", { number: tour }),
    }));
    if (include_null_option) {
      tours.unshift({ value: "all", label: t("commissioning.all_tours") });
    }
    return tours;
  }, [dayTours, include_null_option, t]);

  return (
    <BaseEntitySelector<TourValue | null>
      value={selectedTour}
      onValueChange={setSelectedTour}
      onChange={onTourChange}
      options={options}
      loading={loading}
      placeholder={t("placeholder.tour_selector")}
      disabled={dayTours.length === 0}
      className="bold-select week-selector-select tour-selector"
      preserveSelection={preserveSelection}
      // Without a day there is nothing to check the pick against; a day
      // listing no tours drops it.
      emptyValue={delivery_day === null ? undefined : null}
      autoSelectFirst
    />
  );
};

export default TourSelector;
