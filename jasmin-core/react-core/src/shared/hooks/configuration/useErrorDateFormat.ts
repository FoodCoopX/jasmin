import { useEffect } from "react";
import { setErrorDateFormatter } from "@shared/utils/apiError";
import { useDateFormat } from "./useDateFormat";

/**
 * Hands the tenant's date format to error messages, so a date in an error
 * reads like the forms around it (see ``setErrorDateFormatter``). Called once,
 * in the tenant app shell.
 */
export function useErrorDateFormat(): void {
  const { formatDate } = useDateFormat();
  useEffect(() => {
    setErrorDateFormatter((isoDate) => formatDate(isoDate) ?? isoDate);
    return () => setErrorDateFormatter(null);
  }, [formatDate]);
}
