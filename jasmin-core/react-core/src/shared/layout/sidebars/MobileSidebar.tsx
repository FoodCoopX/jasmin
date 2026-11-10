import { MenuOutlined } from "@ant-design/icons";
import { useTenant, useWashingCleaningVisibility } from "@hooks/index";
import { Drawer, Menu } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { usePackingListVisibility } from "./usePackingListVisibility";

export default function MobileSidebar() {
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();
  const { getSetting } = useTenant();
  const { showBoxesPackingList } = usePackingListVisibility();
  const { showsWashing } = useWashingCleaningVisibility();
  const sells_to_resellers = getSetting("sells_to_resellers", true);

  const menuItemsCommissioning = [
    {
      key: "commissioning-forecast",
      label: (
        <Link to="/commissioning/forecast">{t("commissioning.forecast")}</Link>
      ),
    },

    {
      key: "commissioning-documentation-current-stock",
      label: (
        <Link to="/commissioning/documentation-current-stock">
          {t("commissioning.documentation_amounts")}
        </Link>
      ),
    },

    {
      key: "commissioning-documentation-harvest",
      label: (
        <Link to="/commissioning/documentation-harvest">
          {t("commissioning.documentation_harvest")}
        </Link>
      ),
    },

    ...(showsWashing
      ? [
          {
            key: "commissioning-washing-list",
            label: (
              <Link to="/commissioning/washing-list">
                {t("commissioning.washing_list")}
              </Link>
            ),
          },
        ]
      : []),
    {
      key: "commissioning-harvesting-lists",
      label: (
        <Link to="/commissioning/harvesting-list">
          {t("commissioning.harvesting_lists")}
        </Link>
      ),
    },
    // As in the desktop sidebar: the commissioning lists before the packing
    // list, box packing only for the packing ones, the resellers' list only
    // where the farm sells to resellers.
    ...(showBoxesPackingList
      ? [
          {
            key: "commissioning-commissioning-list-packing",
            label: (
              <Link to="/commissioning/commissioning-list-packing">
                {t("commissioning.commissioning_list_packing")}
              </Link>
            ),
          },
        ]
      : []),
    ...(sells_to_resellers
      ? [
          {
            key: "commissioning-commissioning-list-resellers",
            label: (
              <Link to="/commissioning/commissioning-list-resellers">
                {t("commissioning.commissioning_list_resellers_short")}
              </Link>
            ),
          },
        ]
      : []),
    ...(showBoxesPackingList
      ? [
          {
            key: "commissioning-packing-lists",
            label: (
              <Link to="/commissioning/packing-list-boxes">
                {t("commissioning.packing_lists")}
              </Link>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      {/* Hamburger menu trigger */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t("nav.open_menu")}
        className="mobile-sidebar-trigger"
        onClick={() => setVisible(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setVisible(true); } }}
      >
        <MenuOutlined className="mobile-sidebar-trigger-icon" />
      </div>

      {/* Sidebar drawer */}
      <Drawer
        title={t("nav.navigation")}
        placement="left"
        onClose={() => setVisible(false)}
        open={visible}
        width={250}
      >
        {" "}
        <div className="sidebar-header">{t("nav.commissioning")}</div>
        <Menu
          mode="vertical"
          items={menuItemsCommissioning}
          onClick={() => setVisible(false)}
        />
      </Drawer>
    </>
  );
}
