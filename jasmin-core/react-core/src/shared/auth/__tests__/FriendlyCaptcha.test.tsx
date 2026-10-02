import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FriendlyCaptchaHandle } from "../FriendlyCaptcha";

// A stand-in for the v2 SDK: widgets dispatch the SDK's DOM events on the
// element they were mounted on, and ``destroy()`` removes that element.
const fake = vi.hoisted(() => {
  class FakeWidget {
    element: HTMLElement;
    reset = vi.fn(() => this.emit("frc:widget.reset", ""));
    destroy = vi.fn(() => this.element.remove());

    constructor(element: HTMLElement) {
      this.element = element;
    }

    addEventListener(type: string, listener: (event: Event) => void) {
      this.element.addEventListener(type, listener);
    }

    emit(type: string, response: string) {
      this.element.dispatchEvent(new CustomEvent(type, { detail: { response } }));
    }
  }

  const widgets: FakeWidget[] = [];
  const createWidget = vi.fn((opts: { element: HTMLElement }) => {
    const widget = new FakeWidget(opts.element);
    widgets.push(widget);
    return widget;
  });
  class FriendlyCaptchaSDK {
    createWidget = createWidget;
  }
  return { widgets, createWidget, FriendlyCaptchaSDK };
});

vi.mock("@friendlycaptcha/sdk", () => ({
  FriendlyCaptchaSDK: fake.FriendlyCaptchaSDK,
}));

const tenantState = vi.hoisted(() => ({ sitekey: "FCtestsitekey" }));
vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const withSitekey = makeUseTenantMock({
    tenant: { friendly_captcha_sitekey: "FCtestsitekey" },
  });
  const withoutSitekey = makeUseTenantMock({
    tenant: { friendly_captcha_sitekey: "" },
  });
  return {
    useTenant: () => (tenantState.sitekey ? withSitekey : withoutSitekey),
  };
});

import { FriendlyCaptcha } from "../FriendlyCaptcha";

beforeEach(() => {
  tenantState.sitekey = "FCtestsitekey";
  fake.widgets.length = 0;
  fake.createWidget.mockClear();
});

describe("FriendlyCaptcha", () => {
  it("renders nothing and creates no widget without a sitekey", () => {
    tenantState.sitekey = "";

    const { container } = render(<FriendlyCaptcha onSolution={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(fake.createWidget).not.toHaveBeenCalled();
  });

  it("solves on its own and hands the token to the form", () => {
    const onSolution = vi.fn();
    const { container } = render(<FriendlyCaptcha onSolution={onSolution} />);

    expect(fake.createWidget).toHaveBeenCalledTimes(1);
    expect(fake.createWidget).toHaveBeenCalledWith(
      expect.objectContaining({ sitekey: "FCtestsitekey", startMode: "auto" }),
    );
    // Mounted on a child of the rendered container, which React keeps.
    const [widget] = fake.widgets;
    expect(widget.element.parentElement).toBe(container.firstChild);

    act(() => widget.emit("frc:widget.complete", "token-1"));

    expect(onSolution).toHaveBeenLastCalledWith("token-1");
  });

  it("clears the token when it expires", () => {
    const onSolution = vi.fn();
    render(<FriendlyCaptcha onSolution={onSolution} />);
    const [widget] = fake.widgets;

    act(() => widget.emit("frc:widget.complete", "token-1"));
    act(() => widget.emit("frc:widget.expire", ""));

    expect(onSolution).toHaveBeenLastCalledWith("");
  });

  it("reset() drops the spent token and restarts the widget", () => {
    const onSolution = vi.fn();
    const ref = createRef<FriendlyCaptchaHandle>();
    render(<FriendlyCaptcha ref={ref} onSolution={onSolution} />);
    const [widget] = fake.widgets;
    act(() => widget.emit("frc:widget.complete", "token-1"));

    act(() => ref.current?.reset());

    expect(widget.reset).toHaveBeenCalledTimes(1);
    expect(onSolution).toHaveBeenLastCalledWith("");
  });

  it("destroys the widget and clears the token on unmount", () => {
    const onSolution = vi.fn();
    const { unmount } = render(<FriendlyCaptcha onSolution={onSolution} />);
    const [widget] = fake.widgets;
    act(() => widget.emit("frc:widget.complete", "token-1"));

    unmount();

    expect(widget.destroy).toHaveBeenCalledTimes(1);
    expect(onSolution).toHaveBeenLastCalledWith("");
  });

  it("keeps the widget when the parent passes a new callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<FriendlyCaptcha onSolution={first} />);

    rerender(<FriendlyCaptcha onSolution={second} />);
    act(() => fake.widgets[0].emit("frc:widget.complete", "token-1"));

    expect(fake.createWidget).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith("token-1");
    expect(first).not.toHaveBeenCalledWith("token-1");
  });

  it("shares one SDK between widgets", () => {
    render(
      <>
        <FriendlyCaptcha onSolution={vi.fn()} />
        <FriendlyCaptcha onSolution={vi.fn()} />
      </>,
    );

    // Both widgets come from the same SDK instance.
    const [first, second] = fake.createWidget.mock.contexts;
    expect(fake.createWidget).toHaveBeenCalledTimes(2);
    expect(first).toBeInstanceOf(fake.FriendlyCaptchaSDK);
    expect(second).toBe(first);
  });
});
