/**
 * Ways to read and drive the packing list of boxes as the office does: its
 * selects, their dropdowns and stepping arrows, and requests answered when a
 * test says so.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export function selectNamed(name: string): HTMLElement {
  const select = screen.getByRole("combobox", { name }).closest<HTMLElement>(".ant-select");
  if (!select) throw new Error(`No select named ${name}`);
  return select;
}

/** The label a select shows for its current value. */
export const shownIn = (select: HTMLElement) =>
  select.querySelector(".ant-select-selection-item")?.textContent ?? "";

export function openDropdown(): HTMLElement {
  const open = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-select-dropdown"),
  ).filter((dropdown) => !dropdown.classList.contains("ant-select-dropdown-hidden"));
  const dropdown = open[open.length - 1];
  if (!dropdown) throw new Error("No select dropdown is open");
  return dropdown;
}

export async function optionsOf(select: HTMLElement): Promise<string[]> {
  await userEvent.click(within(select).getByRole("combobox"));
  return Array.from(
    openDropdown().querySelectorAll(".ant-select-item-option-content"),
    (option) => option.textContent ?? "",
  );
}

export async function choose(select: HTMLElement, option: string) {
  await userEvent.click(within(select).getByRole("combobox"));
  await userEvent.click(within(openDropdown()).getByText(option));
}

/** The previous / next arrow beside a stepped selector. */
export function arrow(name: string, direction: "common.previous" | "common.next") {
  const stepper = screen.getByRole("combobox", { name }).closest<HTMLElement>(".ant-space");
  if (!stepper) throw new Error(`No stepper around ${name}`);
  return within(stepper).getByRole("button", { name: direction });
}

/** A request that answers or fails only when the test says so. */
export function pending<T>() {
  let answer!: (value: T) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { promise, answer, fail };
}
