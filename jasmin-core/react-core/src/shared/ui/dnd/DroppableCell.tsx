import { type KeyboardEvent, useCallback } from "react";
import { useDrag, useDrop } from "react-dnd";

import { useDndGrid } from "./DndGridContext";
import type { DndChip, DndDragPayload, GridPos } from "./types";

export interface DroppableCellProps {
  pos: GridPos;
  /** The chip currently in this cell, or null when empty. */
  occupant: DndChip | null;
  /** When false the cell is read-only (no drop, drag, keyboard or remove). */
  canEdit?: boolean;
  /** Visible placeholder text for an empty cell. Supply translated. */
  emptyLabel?: string;
  /** Full accessible name for the cell, overriding the default (occupant label
   *  / ``emptyLabel``). Supply already-translated, position-aware text for grids
   *  where the cell's row/column carries meaning (e.g. "Mon, Category, row 2:
   *  empty"). */
  ariaLabel?: string;
  /** Builds the remove button's accessible name from the occupant label.
   *  When omitted the remove button is not rendered. */
  removeAriaLabelFor?: (label: string) => string;
  /** Marks the cell as a problem, e.g. a placement that no longer fits. The
   *  mark is visual: say why in ``ariaLabel``. */
  flagged?: boolean;
}

interface CellState {
  filled: boolean;
  tinted: boolean;
  over: boolean;
  dragging: boolean;
  selected: boolean;
  refused: boolean;
  flagged: boolean;
}

function cellClassName(state: CellState): string {
  return [
    "dnd-cell",
    state.filled ? "dnd-cell--filled" : "dnd-cell--empty",
    state.tinted ? "dnd-cell--tinted" : "",
    state.over ? "dnd-cell--over" : "",
    state.dragging ? "dnd-cell--dragging" : "",
    state.selected ? "dnd-cell--selected" : "",
    state.refused ? "dnd-cell--refused" : "",
    state.flagged ? "dnd-cell--flagged" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * One grid cell: a drop target that, when filled, is also a drag source (to
 * move/swap) and can be cleared. Keyboard model: with nothing picked up,
 * activating a filled cell picks up its occupant; with something picked up,
 * activating any cell places it there (activating the source cell, or Escape,
 * cancels).
 */
export default function DroppableCell({
  pos,
  occupant,
  canEdit = true,
  emptyLabel,
  ariaLabel,
  removeAriaLabelFor,
  flagged = false,
}: DroppableCellProps) {
  const { place, remove, canPlace, selected, select, itemType } = useDndGrid();

  const refuses = useCallback(
    (payload: DndDragPayload) => (canPlace ? !canPlace(payload, pos) : false),
    [canPlace, pos],
  );

  const [{ isOver, refusesDragged }, drop] = useDrop<
    DndDragPayload,
    void,
    { isOver: boolean; refusesDragged: boolean }
  >(
    () => ({
      accept: itemType,
      canDrop: (item) => canEdit && !refuses(item),
      drop: (item) => place(item, pos),
      collect: (monitor) => {
        // A link, text or file dragged over the page is a drag too, carrying
        // no chip.
        const dragged =
          monitor.getItemType() === itemType
            ? monitor.getItem<DndDragPayload | null>()
            : null;
        return {
          isOver: monitor.isOver() && monitor.canDrop(),
          refusesDragged: dragged ? refuses(dragged) : false,
        };
      },
    }),
    [pos, place, refuses, canEdit, itemType],
  );

  const [{ isDragging }, drag] = useDrag<
    DndDragPayload,
    void,
    { isDragging: boolean }
  >(
    () => ({
      type: itemType,
      item: occupant
        ? { chip: occupant, from: pos }
        : ({} as DndDragPayload),
      canDrag: !!occupant && canEdit,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [occupant, pos, canEdit, itemType],
  );

  // Once the grid changes under a pick-up, its cell may hold another chip.
  const isPickedFromHere =
    selected?.from?.row === pos.row &&
    selected.from.col === pos.col &&
    selected.chip.id === occupant?.id;
  const isRefused = refusesDragged || (!!selected && refuses(selected));

  const onActivate = () => {
    if (!canEdit) return;
    if (selected) {
      if (isPickedFromHere) {
        select(null); // activating the source cell cancels the pick-up
      } else {
        place(selected, pos);
      }
      return;
    }
    if (occupant) {
      select({ chip: occupant, from: pos });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    } else if (event.key === "Escape" && selected) {
      // Escape puts down whatever is picked up.
      select(null);
    }
  };

  const className = cellClassName({
    filled: !!occupant,
    tinted: !!occupant?.color,
    over: isOver,
    dragging: isDragging,
    selected: isPickedFromHere,
    refused: isRefused,
    flagged,
  });

  const accessibleName = ariaLabel ?? (occupant ? occupant.label : emptyLabel);

  // The cell container is the DROP target; the inner <button> is the activatable
  // control (and the drag SOURCE for a filled cell). Keeping the remove button a
  // SIBLING of that action button — not nested inside it — avoids an interactive
  // control inside another (the "nested interactive" a11y failure).
  return (
    <div
      ref={(node) => {
        drop(node);
      }}
      className={className}
      style={occupant?.color ? { backgroundColor: occupant.color } : undefined}
    >
      <button
        ref={(node) => {
          drag(node);
        }}
        type="button"
        className="dnd-cell-action"
        tabIndex={canEdit ? 0 : -1}
        aria-label={accessibleName}
        aria-pressed={isPickedFromHere || undefined}
        aria-disabled={isRefused || undefined}
        onClick={onActivate}
        onKeyDown={onKeyDown}
      >
        {occupant ? (
          <span className="dnd-cell-label">{occupant.label}</span>
        ) : (
          <span className="dnd-cell-placeholder">{emptyLabel}</span>
        )}
      </button>
      {occupant && remove && canEdit && removeAriaLabelFor ? (
        <button
          type="button"
          className="dnd-cell-remove"
          aria-label={removeAriaLabelFor(occupant.label)}
          onClick={(event) => {
            event.stopPropagation();
            remove(pos);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
