/**
 * Ways to drive the packing commissioning list as the office does: its
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

function openDropdown(): HTMLElement {
  const open = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-select-dropdown"),
  ).filter((dropdown) => !dropdown.classList.contains("ant-select-dropdown-hidden"));
  const dropdown = open[open.length - 1];
  if (!dropdown) throw new Error("No select dropdown is open");
  return dropdown;
}

const optionTexts = () =>
  Array.from(
    openDropdown().querySelectorAll<HTMLElement>(".ant-select-item-option-content"),
  );

export async function optionsOf(select: HTMLElement): Promise<string[]> {
  await userEvent.click(within(select).getByRole("combobox"));
  return optionTexts().map((option) => option.textContent ?? "");
}

/** Picks an option by its visible label. The select's hidden accessibility
 * list repeats an option's value, which for a year is its label too. */
export async function choose(select: HTMLElement, option: string) {
  await userEvent.click(within(select).getByRole("combobox"));
  const item = optionTexts().find((content) => content.textContent === option);
  if (!item) throw new Error(`No option ${option}`);
  await userEvent.click(item);
}

/** The previous / next arrow beside a stepped selector. */
export function arrow(name: string, direction: "common.previous" | "common.next") {
  const stepper = screen.getByRole("combobox", { name }).closest<HTMLElement>(".ant-space");
  if (!stepper) throw new Error(`No stepper around ${name}`);
  return within(stepper).getByRole("button", { name: direction });
}

/** A request that answers only when the test says so. */
export function pending<T>() {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}
