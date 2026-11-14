import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  getStaffEmployeesListQueryKey,
  staffEmployeesCreate,
  staffEmployeesDestroy,
  staffEmployeesPartialUpdate,
  useStaffEmployeesList,
  useStaffEmployeesSyncFromHrSystemCreate,
} from "@shared/api/generated/staff/staff";
import type { Employee } from "@shared/api/generated/models";
import { useRoles } from "@shared/auth";
import { useTenant } from "@hooks/index";
import {
  CrudListPage,
  type CrudResource,
  isUnprotectedRow,
  permissionsWithDeletable,
} from "@shared/tables";
import type {
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";
import { notify } from "@shared/utils";
import { useIsActiveColumn } from "@features/commissioning/hooks";
import HrSystemSyncButton from "@features/staff/components/HrSystemSyncButton";
import { useHrSystemSyncRefusal } from "@features/staff/hooks/useHrSystemSyncRefusal";

type EmployeeRow = Employee & TableRecord;

const employeesResource: CrudResource<EmployeeRow> = {
  useList: useStaffEmployeesList,
  create: staffEmployeesCreate,
  update: staffEmployeesPartialUpdate,
  delete: staffEmployeesDestroy,
  getListQueryKey: getStaffEmployeesListQueryKey,
};

export default function ListEmployees() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { handleRefusal, confirmHolder } = useHrSystemSyncRefusal();
  const { getSetting } = useTenant();
  const usesHrSystem = Boolean(getSetting("uses_hr_system", false));
  // Writes here are office-only on the backend (EmployeeViewSet, IsOffice);
  // `canEdit` would offer gardener/staff a save the API refuses.
  const { isOffice } = useRoles();

  // The sync overwrites the name and the active flag of the employees it
  // added, so they aren't edited here, and adds one deleted here back.
  const isActiveOptions = useMemo(
    () => ({
      disabled: (record: TableRecord) =>
        usesHrSystem && Boolean(record.comes_from_hr_system),
    }),
    [usesHrSystem],
  );
  const isActiveColumn = useIsActiveColumn(isActiveOptions);
  const isSynced = isActiveOptions.disabled;
  const permissions = useMemo(
    () => ({
      ...permissionsWithDeletable(isOffice),
      canDeleteRecord: (record: TableRecord) =>
        isUnprotectedRow(record) && !isSynced(record),
    }),
    [isOffice, isSynced],
  );

  const columns = useMemo<EditableColumnConfig<EmployeeRow>[]>(() => {
    const shortNameColumn: EditableColumnConfig<EmployeeRow> = {
      title: <>{t("staff.short_name_for_weekly_plan")}</>,
      dataIndex: "short_name_for_weekly_plan",
      key: "short_name_for_weekly_plan",
      inputType: "text",
      required: true,
      width: "14em",
      align: "left",
      disabled: isSynced,
    };
    if (!usesHrSystem) return [isActiveColumn, shortNameColumn];
    return [
      isActiveColumn,
      {
        title: <>{t("staff.comes_from_hr_system")}</>,
        dataIndex: "comes_from_hr_system",
        key: "comes_from_hr_system",
        inputType: "checkbox",
        // Only the sync sets it.
        disabled: true,
      },
      shortNameColumn,
    ];
  }, [isActiveColumn, isSynced, t, usesHrSystem]);

  const { mutate: syncFromHrSystem, isPending: syncing } =
    useStaffEmployeesSyncFromHrSystemCreate({
      mutation: {
        meta: { silent: true },
        onSuccess: (result) => {
          notify.success(t("staff.hr_system_synced", { ...result }));
          queryClient.invalidateQueries({
            queryKey: getStaffEmployeesListQueryKey(),
          });
        },
        onError: (error) =>
          handleRefusal(error, () =>
            syncFromHrSystem({ data: { confirm_deactivations: true } }),
          ),
      },
    });

  return (
    <CrudListPage<EmployeeRow>
      titleKey="staff.employees"
      explainerKey={
        usesHrSystem
          ? "explainers.list_employees_hr_system"
          : "explainers.list_employees"
      }
      resource={employeesResource}
      permissions={permissions}
      columns={columns}
      uniqueCheck={["short_name_for_weekly_plan"]}
      uniqueCheckMessage={t("validation.unique.name")}
      focusIndex="short_name_for_weekly_plan"
      className="w-max custom-jasmin-table"
      showSearchBar
      toolbar={
        usesHrSystem && isOffice ? (
          <HrSystemSyncButton
            syncing={syncing}
            onSync={() => syncFromHrSystem({ data: {} })}
          />
        ) : null
      }
    >
      {confirmHolder}
    </CrudListPage>
  );
}
