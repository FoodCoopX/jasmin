import type { TFunction } from "i18next";
import { notify } from "@shared/utils";

/**
 * Run the PDF generate-and-upload jobs that follow a finalize, one after the
 * other, and tell the office how many failed.
 *
 * A failed job doesn't stop the rest: the documents themselves are already
 * finalized on the server, and only their stored PDF is missing.
 */
export async function uploadPdfsWarningOnFailure(
  jobs: Array<() => Promise<unknown>>,
  t: TFunction,
): Promise<void> {
  let failed = 0;
  for (const job of jobs) {
    try {
      await job();
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) {
    notify.warning(t("commissioning.pdf_generation_failed", { count: failed }));
  }
}
