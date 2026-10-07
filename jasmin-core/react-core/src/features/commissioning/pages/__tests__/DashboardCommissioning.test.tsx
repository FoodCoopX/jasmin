/**
 * DashboardCommissioning: the commissioning dashboard is a placeholder that
 * shows a single heart icon and nothing else.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DashboardCommissioning from "../DashboardCommissioning";

describe("DashboardCommissioning", () => {
  it("shows only the heart icon", () => {
    const { container } = render(<DashboardCommissioning />);

    expect(screen.getByRole("img", { name: "heart" })).toBeInTheDocument();
    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("[role='img']")).toHaveLength(1);
  });
});
