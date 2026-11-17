import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { DndGridContext } from "./DndGridContext";
import type { DndDragPayload, GridPos } from "./types";
import { DND_CHIP_TYPE } from "./types";

export interface DndGridProps {
  /** Commit a placement. ``payload.from`` set = move between cells; unset =
   *  placed from the palette. The consumer owns the grid state / reducer. */
  onPlace: (payload: DndDragPayload, to: GridPos) => void;
  /** Optional cell-clear handler; enables the remove affordance on filled cells. */
  onRemove?: (pos: GridPos) => void;
  /** Whether a chip may go to a cell. A cell that refuses the chip being
   *  dragged or picked up shows as refused, and a placement there never
   *  reaches ``onPlace``. Every cell may take every chip when omitted. */
  canPlace?: (payload: DndDragPayload, to: GridPos) => boolean;
  /** Override the react-dnd item type (only needed if two grids coexist). */
  itemType?: string;
  children: ReactNode;
}

/**
 * Provides a drag-and-drop grid: the react-dnd HTML5 backend for mouse users
 * AND a keyboard/click "pick up then place" fallback, both funnelling into the
 * same ``onPlace``/``onRemove``. Render {@link DraggableChip}s in a palette and
 * {@link DroppableCell}s in the grid inside this provider — consumers never
 * import react-dnd directly.
 */
export default function DndGrid({
  onPlace,
  onRemove,
  canPlace,
  itemType = DND_CHIP_TYPE,
  children,
}: DndGridProps) {
  const [selected, setSelected] = useState<DndDragPayload | null>(null);

  // A refused keyboard placement keeps the chip picked up, so another cell
  // can still take it.
  const place = useCallback(
    (payload: DndDragPayload, to: GridPos) => {
      if (canPlace && !canPlace(payload, to)) return;
      onPlace(payload, to);
      setSelected(null); // a placement always ends the keyboard "pick up"
    },
    [onPlace, canPlace],
  );

  const value = useMemo(
    () => ({
      place,
      remove: onRemove,
      canPlace,
      itemType,
      selected,
      select: setSelected,
    }),
    [place, onRemove, canPlace, itemType, selected],
  );

  return (
    <DndProvider backend={HTML5Backend}>
      <DndGridContext.Provider value={value}>
        {children}
      </DndGridContext.Provider>
    </DndProvider>
  );
}
