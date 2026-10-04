/**
 * A date in an error's ``details`` reads in the tenant's format once the tenant
 * app has handed ``getErrorMessage`` its formatter (``useErrorDateFormat``), and
 * stays ISO without one.
 */
import { renderHook } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import dayjs from "dayjs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/i18n", () => ({
  default: {
    t: (key: string, values?: Record<string, unknown>) =>
      key === "errors.member.exit_before_transfer"
        ? `The exit is before a transfer (${String(values?.transfer_date)}).`
        : key,
  },
}));

vi.mock("@shared/hooks/configuration/useDateFormat", () => ({
  useDateFormat: () => ({
    formatDate: (value: string) => dayjs(value).format("DD.MM.YYYY"),
  }),
}));

import { useErrorDateFormat } from "@shared/hooks/configuration/useErrorDateFormat";
import { getErrorMessage, setErrorDateFormatter } from "../apiError";

function exitBeforeTransfer(details: Record<string, unknown>): AxiosError {
  const err = new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, null, {
    data: { code: "member.exit_before_transfer", message: "x", details },
    status: 400,
    statusText: "Bad Request",
    headers: {},
    config: { headers: new AxiosHeaders() } as never,
  });
  (err as unknown as { isAxiosError: boolean }).isAxiosError = true;
  return err;
}

afterEach(() => {
  setErrorDateFormatter(null);
});

describe("dates in error messages", () => {
  it("shows a date in the tenant's format", () => {
    setErrorDateFormatter((isoDate) => dayjs(isoDate).format("DD.MM.YYYY"));

    expect(
      getErrorMessage(exitBeforeTransfer({ transfer_date: "2026-09-01" })),
    ).toBe("The exit is before a transfer (01.09.2026).");
  });

  it("leaves the date ISO without a formatter", () => {
    expect(
      getErrorMessage(exitBeforeTransfer({ transfer_date: "2026-09-01" })),
    ).toBe("The exit is before a transfer (2026-09-01).");
  });

  it("leaves a detail that isn't a date alone", () => {
    setErrorDateFormatter((isoDate) => dayjs(isoDate).format("DD.MM.YYYY"));

    expect(
      getErrorMessage(exitBeforeTransfer({ transfer_date: "2026-09" })),
    ).toBe("The exit is before a transfer (2026-09).");
  });

  it("gets the tenant's formatter from the app shell's hook", () => {
    const { unmount } = renderHook(() => useErrorDateFormat());

    expect(
      getErrorMessage(exitBeforeTransfer({ transfer_date: "2026-09-01" })),
    ).toBe("The exit is before a transfer (01.09.2026).");

    unmount();
    expect(
      getErrorMessage(exitBeforeTransfer({ transfer_date: "2026-09-01" })),
    ).toBe("The exit is before a transfer (2026-09-01).");
  });
});
