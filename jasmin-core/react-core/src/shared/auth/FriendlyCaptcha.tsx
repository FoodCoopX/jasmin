/**
 * Friendly Captcha widget wrapper.
 *
 * Renders the FC challenge on every anonymous auth form (login,
 * register, forgot-password, reset-password) through the v2
 * ``@friendlycaptcha/sdk`` and lifts the response token up to the parent
 * form via ``onSolution``.
 *
 * Feature-flag-off behaviour
 * --------------------------
 * The sitekey is sourced from ``TenantContext.tenant.friendly_captcha_sitekey``,
 * which the backend ships as an empty string when
 * ``FRIENDLY_CAPTCHA_ENABLED=False``. Empty sitekey -> component
 * returns ``null`` and the form proceeds as before. So forms can
 * mount this unconditionally; nothing renders until the operator
 * flips the flag + ships keys.
 *
 * Behaviour when enabled
 * ----------------------
 *   1. On mount, the widget starts solving in the background
 *      (``startMode: "auto"``).
 *   2. When the token is ready, ``onSolution(token)`` fires; an expiry, an
 *      error, a reset or an unmount clears it with ``onSolution("")``.
 *   3. A token is single-use: the backend's verification spends it, success
 *      or not. The parent calls ``reset()`` on the forwarded ref after every
 *      submission, and the widget solves a fresh one.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { FriendlyCaptchaSDK, type WidgetHandle } from "@friendlycaptcha/sdk";

import { useTenant } from "@hooks/index";

// One SDK for the whole page; it runs the background agent iframe that every
// widget shares. Created on first use, because constructing it starts that
// agent.
let sdk: FriendlyCaptchaSDK | undefined;

export interface FriendlyCaptchaHandle {
  /** Discard the current token and solve a fresh one. */
  reset: () => void;
}

interface FriendlyCaptchaProps {
  /**
   * Called with the token when the widget completes its challenge, and with
   * the empty string when the token is gone (expired, error, reset).
   * Parent form should treat any non-empty value as "ready to submit".
   */
  onSolution: (solution: string) => void;
}

export const FriendlyCaptcha = forwardRef<
  FriendlyCaptchaHandle,
  FriendlyCaptchaProps
>(function FriendlyCaptcha({ onSolution }, ref) {
  const { tenant } = useTenant();
  const sitekey =
    (tenant?.friendly_captcha_sitekey as string | undefined) ?? "";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<WidgetHandle | null>(null);
  // The widget lives as long as the sitekey; a new onSolution must not
  // rebuild it (and restart the challenge).
  const onSolutionRef = useRef(onSolution);
  useEffect(() => {
    onSolutionRef.current = onSolution;
  }, [onSolution]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        widgetRef.current?.reset();
        onSolutionRef.current("");
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!sitekey || !container) return;

    // ``destroy()`` removes the element the widget is mounted on, so it gets
    // a child React doesn't own.
    const element = document.createElement("div");
    container.appendChild(element);
    sdk ??= new FriendlyCaptchaSDK();
    const widget = sdk.createWidget({ element, sitekey, startMode: "auto" });
    widgetRef.current = widget;

    const clearSolution = () => onSolutionRef.current("");
    widget.addEventListener("frc:widget.complete", (event) =>
      onSolutionRef.current(event.detail.response),
    );
    widget.addEventListener("frc:widget.expire", clearSolution);
    widget.addEventListener("frc:widget.error", clearSolution);
    widget.addEventListener("frc:widget.reset", clearSolution);

    return () => {
      widgetRef.current = null;
      widget.destroy();
      clearSolution();
    };
  }, [sitekey]);

  if (!sitekey) return null;

  return <div ref={containerRef} className="frc-captcha-mount" />;
});

export default FriendlyCaptcha;
