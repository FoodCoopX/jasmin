import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DashboardStaff from "../DashboardStaff";

describe("DashboardStaff", () => {
  it("shows only a heart icon as a placeholder", () => {
    const { container } = render(<DashboardStaff />);

    expect(screen.getByRole("img", { name: "heart" })).toBeInTheDocument();
    expect(container.textContent).toBe("");
  });
});
