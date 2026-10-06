import type { Key, MutableRefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { TableRecord } from "./types";

type UpdatedRows<T> = Map<Key, { replaced: T; row: T }>;

/** The fields of `after` whose values differ from `before`'s. */
function changedFields<T extends TableRecord>(before: T, after: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(after).filter(([field, value]) => !Object.is(value, before[field])),
  ) as Partial<T>;
}

/**
 * Rows updated on this mount, each with the `initialData` row it replaced. A
 * page that doesn't refetch after an update hands that very object back when
 * it re-derives its rows (re-filtering its list, say), and the saved row must
 * win over it. A new object for the id brings only the fields that differ from
 * the replaced one: a page that patches its cached row (after a login change,
 * say) builds on its copy from before the save.
 */
export function useUpdatedRows<T extends TableRecord>(initialData: T[]) {
  const initialDataRef = useRef(initialData);
  initialDataRef.current = initialData;
  const updatedRowsRef = useRef<UpdatedRows<T>>(new Map());
  const rememberUpdatedRow = useCallback((row: T) => {
    const updatedRows = updatedRowsRef.current;
    const replaced =
      updatedRows.get(row.key)?.replaced ??
      initialDataRef.current.find((item) => item.id === row.key);
    if (replaced) updatedRows.set(row.key, { replaced, row });
  }, []);
  return { updatedRowsRef, rememberUpdatedRow };
}

/**
 * Re-reads the table's rows whenever `initialData` changes — and only then —
 * keeping the unsaved new row, the rows created and the rows updated on this
 * mount, and leaving out the rows deleted on it.
 */
export function useInitialDataSync<T extends TableRecord>({
  initialData,
  pinNewRowsToTop,
  setDataWithTransform,
  recentlyAddedIds,
  recentlyDeletedIds,
  updatedRowsRef,
}: {
  initialData: T[];
  pinNewRowsToTop: boolean;
  setDataWithTransform: (data: T[] | ((prev: T[]) => T[])) => void;
  recentlyAddedIds: string[];
  recentlyDeletedIds: string[];
  updatedRowsRef: MutableRefObject<UpdatedRows<T>>;
}): void {
  // Read via ref inside the sync effect so a local ``recentlyAddedIds``
  // update (fired by ``useEditableTable.save`` right after the optimistic
  // ``setData``) does NOT retrigger the effect with a stale ``initialData``
  // — that race would overwrite the just-added row with the pre-refetch
  // list and the row would only reappear after the parent's query refetched.
  // The ref still gives us the latest value when ``initialData`` does
  // legitimately change.
  const recentlyAddedIdsRef = useRef(recentlyAddedIds);
  recentlyAddedIdsRef.current = recentlyAddedIds;
  // Same ref trick for deletions: a row deleted this mount must never be
  // re-introduced by a stale refetch that still contains it (the delete
  // flicker). Read via ref so updating it doesn't retrigger the sync effect.
  const recentlyDeletedIdsRef = useRef(recentlyDeletedIds);
  recentlyDeletedIdsRef.current = recentlyDeletedIds;
  // The sync effect re-reads `initialData` only when `initialData` itself
  // changes. A new column set changes `setDataWithTransform` without bringing
  // newer rows (the hook re-resolves the rows it holds for that), and
  // re-reading then would put back rows from before a save.
  const setDataWithTransformRef = useRef(setDataWithTransform);
  setDataWithTransformRef.current = setDataWithTransform;

  useEffect(() => {
    const setDataWithTransform = setDataWithTransformRef.current;
    const updatedRows = updatedRowsRef.current;
    const toRow = (item: T): T => {
      const key = item.id as Key;
      const updated = updatedRows.get(key);
      if (!updated) return { ...item, key: item.id } as T;
      if (updated.replaced === item) return updated.row;
      // A new object for a row saved on this mount: the page patched it (a
      // login's status, say) or refetched it. A patch builds on the page's
      // copy from before the save, so only what changed since that copy is
      // news; the saved values stay for the rest.
      const row = {
        ...updated.row,
        ...changedFields(updated.replaced, item),
      } as T;
      updatedRows.set(key, { replaced: item, row });
      return row;
    };

    // Preserve any in-flight ``{ key: -1 }`` draft row across an
    // initialData refetch. Race: user clicks "Add" → ``add()`` inserts
    // ``{ key: -1 }`` into local state → before the user hits save,
    // the parent's list query refetches (e.g. a previous modal's
    // invalidate-on-save settles) → this useEffect fires with new
    // ``initialData`` → without preservation, the draft is wiped from
    // ``data`` while ``editingKey`` still points at ``-1``. Symptom:
    // ``save(-1)`` throws "No record found with key: -1" and the user
    // sees a save-failed banner that disappears on refresh.
    const preserveDraft = (mapped: T[], prev: T[]): T[] => {
      const draft = prev.find((row) => row.key === -1);
      if (!draft) return mapped;
      return [draft, ...mapped];
    };

    if (initialData.length > 0) {
      // Drop rows deleted on this mount: a refetch that raced ahead of the
      // backend delete can still include them, which would otherwise undo the
      // optimistic removal and flicker the row back in. Once the backend
      // catches up the refetch no longer contains them, so this is a no-op.
      const deletedSet = new Set(recentlyDeletedIdsRef.current);
      const mapped = initialData
        .map(toRow)
        .filter(
          (row) => !(typeof row.id === "string" && deletedSet.has(row.id)),
        );
      // Pin freshly-created rows to the top so a just-saved row doesn't
      // disappear into an alphabetically-distant page after the refetch.
      // Order within the pinned group: newest first (= insertion order in
      // recentlyAddedIds).
      const pinIds = recentlyAddedIdsRef.current;
      if (pinNewRowsToTop && pinIds.length > 0) {
        const pinnedSet = new Set(pinIds);
        // Use the functional form so we can read the PREVIOUS local
        // state and preserve recently-added rows that aren't in the
        // refetched list yet. Race: the parent's list query refetches
        // (staleTime=0 / refetch-on-focus) before the backend's GET
        // can see the freshly-POSTed row. Without this, the missing
        // row falls out of ``mapped``, the pin loop has nothing to
        // pin for that id, and ``setDataWithTransform(mapped)`` wipes
        // the local optimistic insert — symptom: "row saved but not
        // shown until I refresh the page".
        setDataWithTransform((prev) => {
          const pinned: T[] = [];
          const rest: T[] = [];
          const seen = new Set<string>();
          for (const row of mapped) {
            if (typeof row.id === "string" && pinnedSet.has(row.id)) {
              pinned.push(row);
              seen.add(row.id);
            } else {
              rest.push(row);
            }
          }
          // Reach back into previous local state for recently-added
          // rows that the refetched list doesn't include yet. They
          // stay pinned at the top until the next refetch catches up.
          if (prev.length > 0) {
            const prevById = new Map<string, T>();
            for (const row of prev) {
              if (typeof row.id === "string") {
                prevById.set(row.id, row);
              }
            }
            for (const id of pinIds) {
              if (!seen.has(id) && prevById.has(id)) {
                pinned.push(prevById.get(id) as T);
                seen.add(id);
              }
            }
          }
          pinned.sort(
            (a, b) =>
              pinIds.indexOf(a.id as string) - pinIds.indexOf(b.id as string),
          );
          return preserveDraft([...pinned, ...rest], prev);
        });
      } else {
        setDataWithTransform((prev) => preserveDraft(mapped, prev));
      }
      return;
    }
    // initialData is empty. Preserve two classes of local rows that
    // legitimately belong here despite the empty refetch:
    //
    //   1. The ``{ key: -1 }`` draft (mid-edit, hasn't saved yet).
    //   2. ``recentlyAddedIds`` rows — freshly saved on this mount.
    //      Race: a TanStack Query refetch that arrives BEFORE the
    //      backend has the just-POSTed row (staleTime=0 /
    //      refetch-on-focus / mutation-triggered invalidate). Without
    //      this branch, the first row added to an empty table
    //      disappears on save and only re-appears after a manual
    //      refresh.
    //
    // If neither class applies, fall through to the original
    // "skip the reset when already empty" optimisation.
    setDataWithTransform((prev) => {
      const draft = prev.find((row) => row.key === -1);
      const pinIds = recentlyAddedIdsRef.current;
      const pinned =
        pinIds.length > 0
          ? prev.filter(
              (row) => typeof row.id === "string" && pinIds.includes(row.id),
            )
          : [];
      if (draft || pinned.length > 0) {
        return draft ? [draft, ...pinned] : pinned;
      }
      return prev.length === 0 ? prev : [];
    });
  }, [initialData, pinNewRowsToTop, updatedRowsRef]);
}
