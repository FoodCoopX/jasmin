import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deployment = vi.hoisted(() => ({
  importsShares: false,
  capabilities: {} as Record<string, boolean>,
}));

vi.mock("@hooks/index", () => ({
  useTenant: () => ({
    getSetting: (key: string, defaultValue?: unknown) =>
      key === "uploads_weekly_share_amount"
        ? deployment.importsShares
        : defaultValue,
  }),
  useCapability: (name: string) => deployment.capabilities[name] ?? true,
}));

import { useCommissioningEntryFilter } from "../useCommissioningEntryFilter";

const items = [
  {
    key: "commissioning-amounts",
    children: [
      { key: "commissioning-forecast" },
      { key: "commissioning-import-shares" },
    ],
  },
  {
    key: "commissioning-delivery-stations",
    children: [
      { key: "commissioning-delivery-stations-overview" },
      { key: "commissioning-delivery-stations-details" },
    ],
  },
  {
    key: "commissioning-data",
    children: [
      { key: "commissioning-list-storages" },
      { key: "commissioning-list-delivery-stations" },
      { key: "commissioning-delivery-tours" },
    ],
  },
];

function shownKeys(): string[] {
  const { result } = renderHook(() => useCommissioningEntryFilter());
  return result.current(items).flatMap((item) => [
    item.key,
    ...(item.children ?? []).map((child) => child.key),
  ]);
}

beforeEach(() => {
  deployment.importsShares = false;
  deployment.capabilities = {};
});

describe("useCommissioningEntryFilter", () => {
  it("leaves the share import out of a tenant that plans from subscriptions", () => {
    expect(shownKeys()).not.toContain("commissioning-import-shares");
    expect(shownKeys()).toContain("commissioning-delivery-stations-details");
  });

  it("offers the share import and the delivery stations in the import-shares mode on its own", () => {
    deployment.importsShares = true;

    expect(shownKeys()).toEqual([
      "commissioning-amounts",
      "commissioning-forecast",
      "commissioning-import-shares",
      "commissioning-delivery-stations",
      "commissioning-delivery-stations-overview",
      "commissioning-delivery-stations-details",
      "commissioning-data",
      "commissioning-list-storages",
      "commissioning-list-delivery-stations",
      "commissioning-delivery-tours",
    ]);
  });

  it("drops the share import, the delivery-station section, the station list and the tours inside a host that keeps them", () => {
    deployment.importsShares = true;
    deployment.capabilities = {
      manual_share_import: false,
      delivery_stations: false,
    };

    expect(shownKeys()).toEqual([
      "commissioning-amounts",
      "commissioning-forecast",
      "commissioning-data",
      "commissioning-list-storages",
    ]);
  });
});
