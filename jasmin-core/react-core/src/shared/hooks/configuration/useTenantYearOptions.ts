import dayjs from "dayjs";
import { useMemo } from "react";
import { useTenant } from "./useTenant";

// The fewest years the selectors offer, counted from the tenant's creation year.
const MIN_YEAR_WINDOW = 3;

/**
 * Single source of truth for the year range the Year / Week selectors offer:
 * from the tenant's creation year through next year (at least three years), so
 * the current season and the next stay selectable however old the tenant is.
 * Without a ``created_at`` (e.g. the anonymous ``/tenants/current/`` payload)
 * the range starts at the current year. Both selectors must present the same
 * range, so they read it here.
 */
export function useTenantYearOptions() {
  const { tenant } = useTenant();
  const currentYear = dayjs().year();

  const tenantCreationYear = tenant?.created_at
    ? dayjs(tenant.created_at as string).year()
    : currentYear;
  const lastYear = Math.max(
    tenantCreationYear + MIN_YEAR_WINDOW - 1,
    currentYear + 1,
  );

  const yearOptions = useMemo(
    () =>
      Array.from({ length: lastYear - tenantCreationYear + 1 }, (_, index) => ({
        value: tenantCreationYear + index,
        label: tenantCreationYear + index,
      })),
    [tenantCreationYear, lastYear],
  );

  return { tenantCreationYear, yearOptions };
}
