import { DatePicker } from "antd";
import type { Dayjs } from "dayjs";
import { useState } from "react";
import { useDateFormat, useDateRangePresets } from "@hooks/index";
import { isOutsideStatisticsRange } from "../utils/statisticsRange";

const { RangePicker } = DatePicker;

interface StatisticsRangePickerProps {
  value: [Dayjs, Dayjs] | null;
  onChange: (range: [Dayjs, Dayjs] | null) => void;
  ariaLabel: string;
}

/**
 * The date range picker of a weekly statistics page, with the shared presets
 * and the tenant's date format. Dates the API would refuse are not
 * selectable: the reports' span is capped server-side.
 */
export default function StatisticsRangePicker({
  value,
  onChange,
  ariaLabel,
}: StatisticsRangePickerProps) {
  const { dateFormat } = useDateFormat();
  const presets = useDateRangePresets();

  // The bound already chosen in the open panel, so the other end can be
  // limited to the span the API serves.
  const [pickedBound, setPickedBound] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null);

  return (
    <RangePicker
      value={value}
      onChange={(v) => onChange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
      onCalendarChange={(dates) => setPickedBound(dates)}
      onOpenChange={(open) => {
        if (!open) setPickedBound(null);
      }}
      disabledDate={(current) => isOutsideStatisticsRange(current, pickedBound)}
      presets={presets}
      format={dateFormat}
      allowClear={false}
      aria-label={ariaLabel}
    />
  );
}
