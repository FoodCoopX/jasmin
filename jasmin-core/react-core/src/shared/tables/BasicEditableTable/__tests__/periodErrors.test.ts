import dayjs from "dayjs";
import { describe, expect, it, vi } from "vitest";

// The messages come from the backend's error texts; here they echo the code
// and details, so a test can tell which refusal the rule reproduces.
vi.mock("@shared/utils/apiError", () => ({
  messageForErrorCode: (code: string, details: Record<string, unknown>) =>
    `${code} ${JSON.stringify(details)}`,
}));

import { concurrentRows, periodErrors } from "../periodErrors";
import type { EditableColumnConfig, TableRecord } from "../types";

const columns: EditableColumnConfig[] = [
  { title: "Size", dataIndex: "size", inputType: "select" },
  {
    title: "Valid from",
    dataIndex: "valid_from",
    inputType: "datepicker",
    overlapGroup: ["size"],
  },
  { title: "Valid until", dataIndex: "valid_until", inputType: "datepicker" },
];

const variation = (
  id: string,
  size: string,
  valid_from: string,
  valid_until: string | null = null,
): TableRecord => ({ key: id, id, size, valid_from, valid_until });

// M ended in summer and came back in autumn, S runs on.
const M_SPRING = variation("m-spring", "M", "2026-01-05", "2026-06-28");
const M_AUTUMN = variation("m-autumn", "M", "2026-09-07");
const S_ALL_YEAR = variation("s", "S", "2026-01-05");
const rows = [M_SPRING, M_AUTUMN, S_ALL_YEAR];

const overlap = (from: string, until: string | null) =>
  `time_bound.overlap ${JSON.stringify({
    existing_valid_from: from,
    existing_valid_until: until,
    ...(until === null ? { context: "open" } : {}),
  })}`;

function errorsFor(
  row: Record<string, unknown>,
  { key = -1 as TableRecord["key"], extraRows = [] as TableRecord[] } = {},
) {
  return periodErrors({ columns, rows, extraRows, key, row });
}

describe("periodErrors", () => {
  it("accepts a new row that succeeds the open one of its group", () => {
    expect(errorsFor({ size: "M", valid_from: "2026-11-02" })).toEqual({});
  });

  it("refuses a new row starting before the open one of its group", () => {
    expect(errorsFor({ size: "M", valid_from: "2026-08-03" })).toEqual({
      valid_from: `time_bound.succession_start_before_predecessor ${JSON.stringify({
        new_valid_from: "2026-08-03",
        existing_valid_from: "2026-09-07",
      })}`,
    });
  });

  it("refuses a new row starting the same day as the open one", () => {
    expect(errorsFor({ size: "M", valid_from: "2026-09-07" })).toEqual({
      valid_from: overlap("2026-09-07", null),
    });
  });

  it("refuses a new row inside an ended row's period, marking its start", () => {
    // The open M starts later, so the backend refuses the start first; with
    // only the ended row in the group, the overlap is what remains.
    const errors = periodErrors({
      columns,
      rows: [M_SPRING, S_ALL_YEAR],
      key: -1,
      row: { size: "M", valid_from: "2026-03-02", valid_until: "2026-03-29" },
    });
    expect(errors).toEqual({ valid_from: overlap("2026-01-05", "2026-06-28") });
  });

  it("refuses an edit whose end reaches into the next row, marking its end", () => {
    expect(
      errorsFor(
        { size: "M", valid_from: "2026-01-05", valid_until: "2026-09-27" },
        { key: "m-spring" },
      ),
    ).toEqual({ valid_until: overlap("2026-09-07", null) });
  });

  it("does not compare an edited row with its own stored period", () => {
    expect(
      errorsFor(
        { size: "M", valid_from: "2026-01-05", valid_until: "2026-05-31" },
        { key: "m-spring" },
      ),
    ).toEqual({});
  });

  it("leaves rows of other groups alone", () => {
    expect(errorsFor({ size: "L", valid_from: "2026-01-05" })).toEqual({});
  });

  it("lets a period start the day after another ends", () => {
    expect(
      periodErrors({
        columns,
        rows: [M_SPRING],
        key: -1,
        row: { size: "M", valid_from: "2026-06-29", valid_until: "2026-09-06" },
      }),
    ).toEqual({});
  });

  it("refuses a new row before a later open one even when they don't meet", () => {
    // The backend's succession takes the group's open row for the one the new
    // row succeeds, and refuses a start before it.
    expect(
      errorsFor({ size: "M", valid_from: "2026-06-29", valid_until: "2026-09-06" }),
    ).toEqual({
      valid_from: `time_bound.succession_start_before_predecessor ${JSON.stringify({
        new_valid_from: "2026-06-29",
        existing_valid_from: "2026-09-07",
      })}`,
    });
  });

  it("counts a shared last and first day as overlap", () => {
    expect(
      errorsFor(
        { size: "M", valid_from: "2026-06-28", valid_until: "2026-07-26" },
        { key: "new-row-in-test" },
      ),
    ).toEqual({ valid_from: overlap("2026-01-05", "2026-06-28") });
  });

  it("checks the rows the page keeps out of the table too", () => {
    const hidden = variation("l-hidden", "L", "2027-01-04");
    expect(
      errorsFor({ size: "L", valid_from: "2027-01-04" }, { extraRows: [hidden] }),
    ).toEqual({ valid_from: overlap("2027-01-04", null) });
  });

  it("compares a typed group value with a loaded number", () => {
    const dayColumns: EditableColumnConfig[] = [
      {
        title: "Valid from",
        dataIndex: "valid_from",
        inputType: "datepicker",
        overlapGroup: ["day_number"],
      },
    ];
    const tuesday: TableRecord = {
      key: "tue",
      id: "tue",
      day_number: 2,
      valid_from: "2026-01-05",
      valid_until: "2026-12-27",
    };
    expect(
      periodErrors({
        columns: dayColumns,
        rows: [tuesday],
        key: -1,
        row: { day_number: "2", valid_from: "2026-06-01" },
      }),
    ).toEqual({ valid_from: overlap("2026-01-05", "2026-12-27") });
  });

  it("reads picker values as well as API dates", () => {
    expect(
      errorsFor({ size: "M", valid_from: dayjs("2026-09-07") }),
    ).toEqual({ valid_from: overlap("2026-09-07", null) });
  });

  it("checks nothing until the row has a start", () => {
    expect(errorsFor({ size: "M", valid_from: null })).toEqual({});
  });

  it("checks nothing in a table without an overlap group", () => {
    expect(
      periodErrors({
        columns: columns.map(({ overlapGroup: _group, ...column }) => column),
        rows,
        key: -1,
        row: { size: "M", valid_from: "2026-09-07" },
      }),
    ).toEqual({});
  });
});

describe("concurrentRows", () => {
  it("leaves out the open row a new one of its group closes", () => {
    expect(
      concurrentRows(rows, { size: "M", valid_from: "2026-11-02" }, {
        group: ["size"],
        isNew: true,
      }),
    ).toEqual([S_ALL_YEAR]);
  });

  it("keeps the open row when an existing row is edited", () => {
    expect(
      concurrentRows([M_AUTUMN, S_ALL_YEAR], { size: "M", valid_from: "2026-11-02" }, {
        group: ["size"],
        isNew: false,
      }),
    ).toEqual([M_AUTUMN, S_ALL_YEAR]);
  });

  it("keeps an ended row the new one reaches into", () => {
    expect(
      concurrentRows([M_SPRING], { size: "M", valid_from: "2026-06-01" }, {
        group: ["size"],
        isNew: true,
      }),
    ).toEqual([M_SPRING]);
  });
});
