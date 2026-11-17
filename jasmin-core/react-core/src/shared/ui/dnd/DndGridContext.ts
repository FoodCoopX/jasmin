import { createContext, useContext } from "react";

import type { DndDragPayload, GridPos } from "./types";

export interface DndGridContextValue {
  /** Commit a placement (drop or keyboard "place"). ``payload.from`` set = a
   *  move between cells; unset = placed from the palette. */
  place: (payload: DndDragPayload, to: GridPos) => void;
  /** Clear a cell, if the consumer supports removal. */
  remove?: (pos: GridPos) => void;
  /** Whether a chip may go to a cell; every cell takes every chip when unset. */
  canPlace?: (payload: DndDragPayload, to: GridPos) => boolean;
  /** react-dnd item type shared by every chip/cell in this grid. */
  itemType: string;
  /** The chip currently "picked up" for keyboard/click placement (or null). */
  selected: DndDragPayload | null;
  /** Pick a chip up (or pass null to cancel). */
  select: (payload: DndDragPayload | null) => void;
}

export const DndGridContext = createContext<DndGridContextValue | null>(null);

export function useDndGrid(): DndGridContextValue {
  const ctx = useContext(DndGridContext);
  if (!ctx) {
    throw new Error("useDndGrid must be used within a <DndGrid>.");
  }
  return ctx;
}
