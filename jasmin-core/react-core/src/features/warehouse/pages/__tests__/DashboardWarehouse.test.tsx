import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DashboardWarehouse from "../DashboardWarehouse";

describe("DashboardWarehouse", () => {
  it("shows only a heart icon as a placeholder", () => {
    const { container } = render(<DashboardWarehouse />);

    expect(screen.getByRole("img", { name: "heart" })).toBeInTheDocument();
    expect(container.textContent).toBe("");
  });
});
