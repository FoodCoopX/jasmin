import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import DndGrid from "../DndGrid";
import DraggableChip from "../DraggableChip";
import DroppableCell from "../DroppableCell";
import type { DndChip } from "../types";
import { pastelColorForIndex, PASTEL_PALETTE } from "../usePastelColorMap";

const CHIP: DndChip = { id: "s1", label: "Station 1" };

function renderGrid({
  onPlace = vi.fn(),
  onRemove = vi.fn(),
  cell0 = null as DndChip | null,
  cell1 = null as DndChip | null,
  withPalette = true,
}: {
  onPlace?: Mock;
  onRemove?: Mock;
  cell0?: DndChip | null;
  cell1?: DndChip | null;
  withPalette?: boolean;
} = {}) {
  render(
    <DndGrid onPlace={onPlace} onRemove={onRemove}>
      {withPalette ? <DraggableChip chip={CHIP} /> : null}
      <DroppableCell
        pos={{ row: 0, col: 0 }}
        occupant={cell0}
        emptyLabel="empty-0"
        removeAriaLabelFor={(label) => `remove ${label}`}
      />
      <DroppableCell
        pos={{ row: 0, col: 1 }}
        occupant={cell1}
        emptyLabel="empty-1"
        removeAriaLabelFor={(label) => `remove ${label}`}
      />
    </DndGrid>,
  );
  return { onPlace, onRemove };
}

describe("DnD grid — click/keyboard placement", () => {
  it("selects a palette chip then places it into an empty cell", async () => {
    const user = userEvent.setup();
    const { onPlace } = renderGrid();

    await user.click(screen.getByRole("button", { name: "Station 1" }));
    await user.click(screen.getByRole("button", { name: "empty-0" }));

    expect(onPlace).toHaveBeenCalledTimes(1);
    const [payload, to] = onPlace.mock.calls[0];
    expect(payload.chip.id).toBe("s1");
    expect(payload.from).toBeUndefined(); // came from the palette
    expect(to).toEqual({ row: 0, col: 0 });
  });

  it("picks up a filled cell's occupant and moves it to another cell", async () => {
    const user = userEvent.setup();
    // No palette chip so "Station 1" unambiguously refers to the filled cell.
    const { onPlace } = renderGrid({ cell0: CHIP, withPalette: false });

    await user.click(screen.getByRole("button", { name: "Station 1" }));
    await user.click(screen.getByRole("button", { name: "empty-1" }));

    expect(onPlace).toHaveBeenCalledTimes(1);
    const [payload, to] = onPlace.mock.calls[0];
    expect(payload.chip.id).toBe("s1");
    expect(payload.from).toEqual({ row: 0, col: 0 }); // a move, not a palette drop
    expect(to).toEqual({ row: 0, col: 1 });
  });

  it("cancels the pick-up when the source cell is activated again", async () => {
    const user = userEvent.setup();
    const { onPlace } = renderGrid({ cell0: CHIP, withPalette: false });

    const filled = screen.getByRole("button", { name: "Station 1" });
    await user.click(filled); // pick up
    await user.click(filled); // activate source again -> cancel

    expect(onPlace).not.toHaveBeenCalled();
  });

  it("drops the pick-up mark once another chip sits in the source cell", async () => {
    const user = userEvent.setup();
    const other: DndChip = { id: "s2", label: "Station 2" };
    const grid = (occupant: DndChip) => (
      <DndGrid onPlace={vi.fn()}>
        <DroppableCell pos={{ row: 0, col: 0 }} occupant={occupant} />
      </DndGrid>
    );
    const { rerender } = render(grid(CHIP));
    await user.click(screen.getByRole("button", { name: "Station 1" }));
    expect(screen.getByRole("button", { name: "Station 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    rerender(grid(other));

    expect(
      screen.getByRole("button", { name: "Station 2" }),
    ).not.toHaveAttribute("aria-pressed");
  });

  it("removes an occupant via the remove button without selecting it", async () => {
    const user = userEvent.setup();
    const { onRemove, onPlace } = renderGrid({ cell0: CHIP, withPalette: false });

    await user.click(screen.getByRole("button", { name: "remove Station 1" }));

    expect(onRemove).toHaveBeenCalledWith({ row: 0, col: 0 });
    expect(onPlace).not.toHaveBeenCalled(); // stopPropagation kept the cell inert
  });

  it("supports keyboard placement (Enter to select, Enter to place)", () => {
    const { onPlace } = renderGrid();

    fireEvent.keyDown(screen.getByRole("button", { name: "Station 1" }), {
      key: "Enter",
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "empty-1" }), {
      key: "Enter",
    });

    expect(onPlace).toHaveBeenCalledTimes(1);
    const [payload, to] = onPlace.mock.calls[0];
    expect(payload.chip.id).toBe("s1");
    expect(to).toEqual({ row: 0, col: 1 });
  });

  it("does not allow editing a read-only cell", async () => {
    const user = userEvent.setup();
    const onPlace = vi.fn();
    render(
      <DndGrid onPlace={onPlace}>
        <DraggableChip chip={CHIP} />
        <DroppableCell
          pos={{ row: 0, col: 0 }}
          occupant={null}
          canEdit={false}
          emptyLabel="empty-0"
        />
      </DndGrid>,
    );

    await user.click(screen.getByRole("button", { name: "Station 1" }));
    await user.click(screen.getByRole("button", { name: "empty-0" }));

    expect(onPlace).not.toHaveBeenCalled();
  });
});

describe("DnD grid — cells that refuse a chip", () => {
  // Column 0 refuses the chip, column 1 takes it.
  function renderRefusingGrid(onPlace = vi.fn()) {
    render(
      <DndGrid onPlace={onPlace} canPlace={(_payload, to) => to.col !== 0}>
        <DraggableChip chip={CHIP} />
        <DroppableCell pos={{ row: 0, col: 0 }} occupant={null} emptyLabel="empty-0" />
        <DroppableCell pos={{ row: 0, col: 1 }} occupant={null} emptyLabel="empty-1" />
      </DndGrid>,
    );
    return { onPlace };
  }

  it("marks the refusing cells only while a chip is picked up", async () => {
    const user = userEvent.setup();
    renderRefusingGrid();
    const refusing = screen.getByRole("button", { name: "empty-0" });

    expect(refusing).not.toHaveAttribute("aria-disabled");
    expect(refusing.parentElement).not.toHaveClass("dnd-cell--refused");

    await user.click(screen.getByRole("button", { name: "Station 1" }));

    expect(refusing).toHaveAttribute("aria-disabled", "true");
    expect(refusing.parentElement).toHaveClass("dnd-cell--refused");
    expect(screen.getByRole("button", { name: "empty-1" }).parentElement).not.toHaveClass(
      "dnd-cell--refused",
    );
  });

  it("keeps the chip picked up on a refusing cell, so another cell takes it", async () => {
    const user = userEvent.setup();
    const { onPlace } = renderRefusingGrid();

    await user.click(screen.getByRole("button", { name: "Station 1" }));
    await user.click(screen.getByRole("button", { name: "empty-0" }));

    expect(onPlace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "empty-1" }));

    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace.mock.calls[0][1]).toEqual({ row: 0, col: 1 });
  });

  it("flags a cell on request", () => {
    render(
      <DndGrid onPlace={vi.fn()}>
        <DroppableCell pos={{ row: 0, col: 0 }} occupant={CHIP} flagged />
        <DroppableCell pos={{ row: 0, col: 1 }} occupant={null} emptyLabel="empty-1" />
      </DndGrid>,
    );

    expect(screen.getByRole("button", { name: "Station 1" }).parentElement).toHaveClass(
      "dnd-cell--flagged",
    );
    expect(screen.getByRole("button", { name: "empty-1" }).parentElement).not.toHaveClass(
      "dnd-cell--flagged",
    );
  });
});

describe("pastelColorForIndex", () => {
  it("cycles through the palette", () => {
    expect(pastelColorForIndex(0)).toBe(PASTEL_PALETTE[0]);
    expect(pastelColorForIndex(PASTEL_PALETTE.length)).toBe(PASTEL_PALETTE[0]);
    expect(pastelColorForIndex(PASTEL_PALETTE.length + 1)).toBe(PASTEL_PALETTE[1]);
  });
});
