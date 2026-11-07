import { useCapability, useTenant } from "@hooks/index";
import { useCommissioningDeliveryStationsList } from "@shared/api/generated/commissioning/commissioning";
import { useRoles, type RoleGatedItem } from "@shared/auth";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import DirectionsBikeIcon from "@mui/icons-material/DirectionsBike";

/**
 * The commissioning sidebar's delivery-station links: the section with the
 * tour and pickup lists (and the station-fee billing), and the station and
 * tour lists for the data section. The members' notices come with the pickup
 * lists, so they have an entry of their own only where those are missing: a
 * farm that imports its share amounts has no pickup lists, and where the host
 * keeps its pickup locations itself, it handles the stations, the tours and
 * the pickup lists on its side — the section then holds only the notices, and
 * the data section nothing.
 */
export function useDeliveryStationNavItems() {
  const { t } = useTranslation();
  const flags = useRoles();
  const offersDeliveryStations = useCapability("delivery_stations");
  const { getSetting } = useTenant();
  const importsShareAmounts = Boolean(getSetting("uploads_weekly_share_amount"));

  // The station-fee billing is only relevant for solawis that actually charge
  // pickup-station fees. Fetch stations only for office users (the only ones who
  // could see the entry) and gate on any non-zero net fee.
  const { data: stationsForFeeGate } = useCommissioningDeliveryStationsList(
    {},
    { query: { enabled: flags.isOffice && offersDeliveryStations } },
  );
  const has_station_fees = (stationsForFeeGate ?? []).some(
    (station) =>
      Number(station.fee_per_box_net) > 0 ||
      Number(station.fee_per_month_net) > 0 ||
      Number(station.fee_per_year_net) > 0,
  );

  const section = (children: RoleGatedItem[]): RoleGatedItem[] => [
    {
      key: "commissioning-delivery-stations",

      requireRole: "isStaff",
      icon: <DirectionsBikeIcon />,
      label: (
        <div className="sidebar-section-header">
          {t("commissioning.delivery_stations")}
        </div>
      ),
      children,
    },
  ];

  const stationNotices: RoleGatedItem = {
    key: "commissioning-station-notices",

    requireRole: "isStaff",
    label: (
      <Link to="/commissioning/station-notices">
        {t("commissioning.station_contents.page_title")}
      </Link>
    ),
  };

  if (!offersDeliveryStations) {
    return {
      deliveryStationSection: section([stationNotices]),
      deliveryStationListItems: [],
    };
  }

  const deliveryStationSection = section([
    {
      key: "commissioning-delivery-stations-overview",

      requireRole: "isStaff",
      label: (
        <Link to="/commissioning/delivery-stations-overview">
          {t("commissioning.tour_lists")}
        </Link>
      ),
    },
    {
      key: "commissioning-delivery-stations-details",

      requireRole: "isStaff",
      label: (
        <Link to="/commissioning/delivery-stations-details">
          {t("commissioning.pickup_lists")}
        </Link>
      ),
    },
    ...(importsShareAmounts ? [stationNotices] : []),

    // Only when at least one station actually charges a fee — most solawis
    // don't, so hide the billing entirely for them.
    ...(has_station_fees
      ? [
          {
            key: "commissioning-delivery-station-fees",

            requireRole: "isOffice" as const,
            label: (
              <Link to="/commissioning/delivery-station-fees">
                {t("commissioning.station_fees")}
              </Link>
            ),
          },
        ]
      : []),
  ]);
  const deliveryStationListItems: RoleGatedItem[] = [
    {
      key: "commissioning-list-delivery-stations",

      requireRole: "isStaff",
      label: (
        <Link to="/commissioning/list-delivery-stations">
          {t("commissioning.list_delivery_stations")}
        </Link>
      ),
    },
    {
      key: "commissioning-delivery-tours",

      requireRole: "isStaff",
      label: (
        <Link to="/commissioning/delivery-tours">
          {t("commissioning.delivery_tours")}
        </Link>
      ),
    },
  ];
  return { deliveryStationSection, deliveryStationListItems };
}
