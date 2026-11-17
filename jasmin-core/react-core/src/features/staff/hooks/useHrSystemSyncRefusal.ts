import { Modal } from "antd";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { notify } from "@shared/utils";
import {
  getErrorCode,
  getErrorDetails,
  getErrorMessage,
} from "@shared/utils/apiError";

/**
 * Answers a refused HR-system sync. The refusal that stops the sync from
 * deactivating more than half of the employees asks for a confirmation and,
 * given it, runs `confirmDeactivations`; any other refusal shows its message.
 * Render `confirmHolder` on the page, and give the sync's mutation
 * `meta: { silent: true }` so the app-wide error toast stays out of it.
 */
export function useHrSystemSyncRefusal() {
  const { t } = useTranslation();
  const [modal, confirmHolder] = Modal.useModal();

  const handleRefusal = useCallback(
    (error: unknown, confirmDeactivations: () => void) => {
      if (getErrorCode(error) !== "staff.hr_system_mass_deactivation") {
        notify.error(getErrorMessage(error, t("common.action_failed")));
        return;
      }
      const employees = getErrorDetails(error)?.employees;
      const names = Array.isArray(employees) ? employees.join(", ") : "";
      modal.confirm({
        title: t("staff.hr_system_mass_deactivation_title"),
        content: t("staff.hr_system_mass_deactivation_text", { names }),
        okText: t("staff.hr_system_deactivate"),
        okButtonProps: { danger: true },
        cancelText: t("common.cancel"),
        onOk: confirmDeactivations,
      });
    },
    [modal, t],
  );

  return { handleRefusal, confirmHolder };
}
