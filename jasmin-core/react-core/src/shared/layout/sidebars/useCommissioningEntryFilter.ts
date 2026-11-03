import { useCapability, useTenant } from "@hooks/index";
import type { RoleGatedItem } from "@shared/auth";

/** The items without the entries keyed in ``hidden``, at any depth. */
function withoutEntries<T extends RoleGatedItem>(
  items: T[],
  hidden: ReadonlySet<string>,
): T[] {
  return items.flatMap((item) => {
    if (hidden.has(item.key)) return [];
    if (!item.children) return [item];
    return [{ ...item, children: withoutEntries(item.children, hidden) }];
  });
}

/**
 * The commissioning entries that depend on the operating mode or the host
 * rather than on the viewer's role. The share import exists in the
 * import-shares mode, but not where a host imports the amounts on every visit;
 * the pickup lists not where a host prints its own. Returns the filter the
 * sidebar applies to its items, before the role filter drops emptied groups.
 */
export function useCommissioningEntryFilter() {
  const { getSetting } = useTenant();
  const offersManualShareImport = useCapability("manual_share_import");
  const offersPickupLists = useCapability("pickup_lists");
  const importsShares = Boolean(
    getSetting("uploads_weekly_share_amount", false),
  );

  const hidden = new Set<string>();
  if (!importsShares || !offersManualShareImport) {
    hidden.add("commissioning-import-shares");
  }
  if (!offersPickupLists) hidden.add("commissioning-delivery-stations-details");
  return <T extends RoleGatedItem>(items: T[]) => withoutEntries(items, hidden);
}
