import { useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Flex, Select, Space } from "antd";
import { useTranslation } from "react-i18next";
import { useDateFormat, useDeliveryDayLabel, useIsMobile } from '@hooks/index';
import { activeAtDateForWeek, getStatusColor } from "@shared/utils";
import { useShareDeliveryDays } from '@features/commissioning/hooks';
import { SteppedSelect } from "@shared/selectors";
import { EmptyHint } from "@shared/ui";

const { Option } = Select;

interface SharesDeliveryDaySelectorProps {
  selectedSharesDeliveryDay: string | null;
  setSelectedSharesDeliveryDay: (value: string | null) => void;
  onSharesDeliveryDayChange?:
    | ((value: string | null, selectedDay?: unknown) => void)
    | null;
  include_null_option?: boolean;
  active_at_date?: string;
  selectedYear?: number;
  selectedWeek?: number | null;
  suffix?: string | null;
}

const SharesDeliveryDaySelector = ({
  selectedSharesDeliveryDay,
  setSelectedSharesDeliveryDay,
  onSharesDeliveryDayChange = null,
  include_null_option = false,
  active_at_date,
  selectedYear,
  selectedWeek,
  suffix = null,
}: SharesDeliveryDaySelectorProps) => {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const isMobile = useIsMobile();
  const deliveryDayLabel = useDeliveryDayLabel();

  const useDayFormat = !!selectedYear && !!selectedWeek;

  // Scope the fetch to the selected week (its Saturday) so only that week's
  // ACTIVE delivery days show — not stale/duplicate time-bound records (e.g. two
  // Fridays). An explicit ``active_at_date`` prop still wins.
  const effectiveActiveAtDate =
    active_at_date ??
    (selectedYear && selectedWeek
      ? activeAtDateForWeek(selectedYear, selectedWeek)
      : undefined);
  const isWeekScoped = !!effectiveActiveAtDate;
  const { shareDeliveryDays, loading, pending, noDaysListed } =
    useShareDeliveryDays(
      effectiveActiveAtDate ? { active_at_date: effectiveActiveAtDate } : {},
    );

  // Enrich delivery days with labels and status colors
  // (status color via the shared ``getStatusColor``).
  const enrichedDays = useMemo(() => {
    return shareDeliveryDays.map((day) => {
      const validFrom = formatDate(day.valid_from);
      const validUntil = formatDate(day.valid_until);

      let datePart = "";
      if (validFrom) {
        datePart = `${t("commissioning.valid_from")} ${validFrom}`;
      }
      if (validUntil) {
        datePart += ` ${t("commissioning.valid_until")} ${validUntil}`;
      }

      return {
        ...day,
        datePart,
        statusColor: getStatusColor(day.valid_from, day.valid_until),
      };
    });
  }, [shareDeliveryDays, formatDate, t]);

  // Once the list is in, the pick is one of its days; a list still on its way,
  // also one waiting offline for the network, changes nothing. A listed pick
  // stays; anything else becomes the first day, or no day where "all delivery
  // days" is offered. A week without delivery days, or whose days failed to
  // load, leaves nothing to pick. The list of every delivery day keeps its
  // pick when it comes back empty: a page may set a day of its own whenever
  // none is picked, and clearing it here would undo that in a loop.
  useEffect(() => {
    if (pending) return;
    if (!enrichedDays.length) {
      if (isWeekScoped && selectedSharesDeliveryDay !== null) {
        setSelectedSharesDeliveryDay(null);
      }
      return;
    }
    const keepPick =
      selectedSharesDeliveryDay === null
        ? include_null_option
        : enrichedDays.some((day) => day.value === selectedSharesDeliveryDay);
    if (!keepPick) {
      setSelectedSharesDeliveryDay(
        include_null_option ? null : enrichedDays[0].value,
      );
    }
  }, [
    enrichedDays,
    pending,
    isWeekScoped,
    selectedSharesDeliveryDay,
    setSelectedSharesDeliveryDay,
    include_null_option,
  ]);

  const weekHasNoDays = isWeekScoped && noDaysListed;
  const placeholder = weekHasNoDays
    ? t("commissioning.no_delivery_days_in_week")
    : t("placeholder.shares_delivery_day_selector");
  const emptyWeekHint = weekHasNoDays ? (
    <EmptyHint>{t("commissioning.no_delivery_days_in_week")}</EmptyHint>
  ) : undefined;

  // Compute date label for a delivery day in the selected week
  const calculateDate = useCallback(
    (dayNumber: number | null | undefined) => {
      if (!selectedYear || !selectedWeek || dayNumber == null) return "";
      return deliveryDayLabel(selectedYear, selectedWeek, dayNumber);
    },
    [selectedYear, selectedWeek, deliveryDayLabel],
  );

  // Sort enriched days by day_number for navigation
  const sortedDays = useMemo(() => {
    return [...enrichedDays].sort(
      (a, b) => (a.day_number as number) - (b.day_number as number),
    );
  }, [enrichedDays]);

  const currentIndex = sortedDays.findIndex(
    (d) => d.id === selectedSharesDeliveryDay,
  );
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < sortedDays.length - 1;

  const prevDay = useCallback(() => {
    if (canGoPrev) {
      const prev = sortedDays[currentIndex - 1];
      setSelectedSharesDeliveryDay(prev.id!);
      if (onSharesDeliveryDayChange) onSharesDeliveryDayChange(prev.id!, prev);
    }
  }, [
    canGoPrev,
    sortedDays,
    currentIndex,
    setSelectedSharesDeliveryDay,
    onSharesDeliveryDayChange,
  ]);

  const nextDay = useCallback(() => {
    if (canGoNext) {
      const next = sortedDays[currentIndex + 1];
      setSelectedSharesDeliveryDay(next.id!);
      if (onSharesDeliveryDayChange) onSharesDeliveryDayChange(next.id!, next);
    }
  }, [
    canGoNext,
    sortedDays,
    currentIndex,
    setSelectedSharesDeliveryDay,
    onSharesDeliveryDayChange,
  ]);

  const sharesDeliveryDayOptions = useMemo(() => {
    const options: { value: string | null; label: ReactNode }[] = [];

    if (include_null_option) {
      options.push({ value: null, label: "-" });
    }

    enrichedDays.forEach((day) => {
      if (useDayFormat) {
        options.push({
          value: day.id!,
          label: calculateDate(day.day_number),
        });
      } else {
        options.push({
          value: day.id!,
          label: (
            <Flex align="center" component="span">
              {day.statusColor ? (
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    backgroundColor: day.statusColor,
                    marginRight: "8px",
                    borderRadius: "2px",
                  }}
                />
              ) : null}
              {day.label}
              {day.datePart ? (
                <span
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: "0.85em",
                    marginLeft: "8px",
                  }}
                >
                  {day.datePart}
                </span>
              ) : null}
            </Flex>
          ),
        });
      }
    });

    return options;
  }, [enrichedDays, include_null_option, useDayFormat, calculateDate]);

  const handleSharesDeliveryDayChange = useCallback(
    (value: string | null) => {
      setSelectedSharesDeliveryDay(value);
      if (onSharesDeliveryDayChange) {
        const selectedDay = enrichedDays.find((day) => day.id === value);
        onSharesDeliveryDayChange(value, selectedDay);
      }
    },
    [setSelectedSharesDeliveryDay, onSharesDeliveryDayChange, enrichedDays],
  );

  if (useDayFormat) {
    return (
      <Space>
        <SteppedSelect
          showDivider
          value={selectedSharesDeliveryDay}
          onChange={handleSharesDeliveryDayChange}
          onPrev={prevDay}
          onNext={nextDay}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          selectStyle={{ width: isMobile ? "10em" : suffix ? "22em" : "15em" }}
          selectAriaLabel={t("placeholder.shares_delivery_day_selector")}
          placeholder={placeholder}
          loading={loading}
          notFoundContent={emptyWeekHint}
        >
          {include_null_option && (
            <Option key="none" value={null}>
              {t("commissioning.all_delivery_days")}
            </Option>
          )}
          {sortedDays.map((day) => (
            <Option key={day.id} value={day.id}>
              {!isMobile && suffix ? `${suffix} ` : ""}
              {calculateDate(day.day_number)}
            </Option>
          ))}
        </SteppedSelect>
      </Space>
    );
  }

  return (
    <Select
      value={selectedSharesDeliveryDay}
      style={{ width: "30em" }}
      size="small"
      onChange={handleSharesDeliveryDayChange}
      options={sharesDeliveryDayOptions}
      className="bold-select week-selector-select"
      placeholder={placeholder}
      aria-label={t("placeholder.shares_delivery_day_selector")}
      loading={loading}
      notFoundContent={emptyWeekHint}
    />
  );
};

export default SharesDeliveryDaySelector;
