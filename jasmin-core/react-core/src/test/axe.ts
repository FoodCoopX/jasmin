import { configureAxe } from "vitest-axe";

/**
 * axe for a rendered page or widget:
 * `expect(await axe(container)).toHaveNoViolations()`.
 *
 * Two rules can't be judged on a single component in jsdom. `region` wants
 * every element inside a landmark, and a test renders without the app shell
 * that provides them. `color-contrast` needs layout and painted colours, which
 * jsdom doesn't compute.
 */
export const axe = configureAxe({
  rules: {
    region: { enabled: false },
    "color-contrast": { enabled: false },
  },
});
