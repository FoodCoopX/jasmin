import { useState } from "react";

import { SUPER_ADMIN_ENDPOINTS } from "@features/platform/services/superAdmin";
import axiosService from "@shared/services/api";
import { notify } from "@shared/utils";
import { getErrorMessage } from "@shared/utils/apiError";

export interface ActionRateLimitDefault {
  action: string;
  display_name: string;
  weekly: number;
  per_minute: number;
}

type Bound = "weekly" | "per_minute";

export type ActionRateLimitOverrides = Record<
  string,
  Partial<Record<Bound, number>>
>;

// What the inputs hold: the override as typed, "" where the default applies.
type Draft = Record<string, Record<Bound, string>>;

const BOUNDS: Bound[] = ["weekly", "per_minute"];

function toDraft(
  defaults: ActionRateLimitDefault[],
  overrides: ActionRateLimitOverrides,
): Draft {
  return Object.fromEntries(
    defaults.map(({ action }) => [
      action,
      {
        weekly: String(overrides[action]?.weekly ?? ""),
        per_minute: String(overrides[action]?.per_minute ?? ""),
      },
    ]),
  );
}

function toOverrides(draft: Draft): ActionRateLimitOverrides {
  const overrides: ActionRateLimitOverrides = {};
  for (const [action, caps] of Object.entries(draft)) {
    for (const bound of BOUNDS) {
      if (caps[bound].trim() !== "") {
        overrides[action] = {
          ...overrides[action],
          [bound]: Number(caps[bound]),
        };
      }
    }
  }
  return overrides;
}

interface TenantRateLimitsProps {
  tenantId: string;
  defaults: ActionRateLimitDefault[];
  overrides: ActionRateLimitOverrides;
  onSaved: () => void;
}

/**
 * The tenant's caps on the rate-limited actions — invoice and delivery-note
 * finalization, SEPA charge runs, member and user creation, subscription
 * confirmation. Each shows its default and takes an optional weekly and
 * per-minute override; a blank one keeps the default. Saving replaces the
 * stored overrides and asks for a fresh step-up confirmation.
 */
export default function TenantRateLimits({
  tenantId,
  defaults,
  overrides,
  onSaved,
}: TenantRateLimitsProps) {
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(defaults, overrides),
  );
  const [saving, setSaving] = useState(false);

  const setCap = (action: string, bound: Bound, value: string) =>
    setDraft((current) => ({
      ...current,
      [action]: { ...current[action], [bound]: value },
    }));

  const save = async () => {
    setSaving(true);
    try {
      await axiosService.patch(SUPER_ADMIN_ENDPOINTS.tenant(tenantId), {
        action_rate_limit_overrides: toOverrides(draft),
      });
      notify.success("Rate limits saved");
      onSaved();
    } catch (error) {
      notify.error(getErrorMessage(error, "Failed to save the rate limits"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h3 className="sa-subheading">Rate limits</h3>
      <p className="sa-help-text">
        Caps on actions an office account could otherwise flood. Leave a field
        blank to keep the default.
      </p>
      <div className="sa-table-scroll">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Per week</th>
              <th>Per minute</th>
            </tr>
          </thead>
          <tbody>
            {defaults.map((row) => (
              <tr key={row.action}>
                <td>{row.display_name}</td>
                {BOUNDS.map((bound) => (
                  <td key={bound}>
                    <input
                      type="number"
                      min={1}
                      className="sa-form-input"
                      aria-label={`${row.display_name}: ${bound === "weekly" ? "per week" : "per minute"}`}
                      placeholder={`${row[bound]} (default)`}
                      value={draft[row.action]?.[bound] ?? ""}
                      onChange={(event) =>
                        setCap(row.action, bound, event.target.value)
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sa-toolbar">
        <button
          onClick={save}
          disabled={saving}
          className="sa-btn sa-btn--primary"
        >
          {saving ? "..." : "Save rate limits"}
        </button>
      </div>
    </>
  );
}
