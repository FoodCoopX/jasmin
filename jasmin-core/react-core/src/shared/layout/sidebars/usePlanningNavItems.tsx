import { useShareTypes } from "@hooks/index";
import type { RoleGatedItem } from "@shared/auth";
import {
  governingShareType,
  PLANNING_SHARE_OPTIONS,
} from "@shared/planning/planningShareOptions";
import { todayApiDate } from "@shared/utils/apiDate";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/**
 * The commissioning sidebar's planning links, one set per share option that
 * has a current or upcoming share type. An option whose governing share type
 * (the one active today, else the upcoming one) is complex-planned gets a
 * per-week link and a long-term link under the share planning section
 * (``commissioning.planning_share_content``); a simple one gets only a
 * long-term link, for the "additional shares" section. Order follows
 * ``PLANNING_SHARE_OPTIONS``.
 *
 * Each link is named after its governing share type's ``name``, the name
 * the farm gave it; an option whose share type has none keeps its translated
 * name.
 */
export function usePlanningNavItems() {
  const { t } = useTranslation();
  const planningToday = todayApiDate();
  const { shareTypes: activePlanningShareTypes } = useShareTypes({
    active_at_date: planningToday,
    // Current + upcoming share types, so an option whose season hasn't started
    // yet still gets its planning nav.
    include_future: true,
  });
  // Group by option, then classify each by its GOVERNING share type (the one
  // active today, else the upcoming one) — a future successor must not change
  // today's section.
  const shareTypesByOption = new Map<string, typeof activePlanningShareTypes>();
  for (const st of activePlanningShareTypes) {
    if (!st.share_option) continue;
    const group = shareTypesByOption.get(st.share_option) ?? [];
    group.push(st);
    shareTypesByOption.set(st.share_option, group);
  }
  const complexByOption = new Map<string, boolean>();
  const nameByOption = new Map<string, string>();
  for (const [option, group] of shareTypesByOption) {
    const governing = governingShareType(group, planningToday);
    complexByOption.set(
      option,
      governing ? (governing.needs_complex_planning ?? true) : true,
    );
    if (governing?.name) nameByOption.set(option, governing.name);
  }
  const activePlanningConfigs = PLANNING_SHARE_OPTIONS.filter((c) =>
    complexByOption.has(c.shareOption),
  );
  const complexPlanningOptions = activePlanningConfigs.filter((c) =>
    complexByOption.get(c.shareOption),
  );
  const simplePlanningOptions = activePlanningConfigs.filter(
    (c) => !complexByOption.get(c.shareOption),
  );

  const planningComplexItems: RoleGatedItem[] = complexPlanningOptions.map(
    (c) => ({
      key: `commissioning-planning-${c.slug}`,
      requireRole: "isOffice",
      label: (
        <Link to={`/commissioning/planning/${c.slug}`}>
          {nameByOption.get(c.shareOption) ?? t(c.complexSidebarKey)}
        </Link>
      ),
    }),
  );
  const planningLongTermItems: RoleGatedItem[] = complexPlanningOptions.map(
    (c) => {
      const shareTypeName = nameByOption.get(c.shareOption);
      return {
        key: `commissioning-planning-${c.slug}-long-term`,
        requireRole: "isOffice",
        label: (
          <Link to={`/commissioning/planning/${c.slug}/long-term`}>
            {/* Marked "long-term" whenever the link has no distinct long-term
                label of its own (a share type's name, or additional shares
                reusing one key for both modes), so a complex option's two
                links don't read identically. */}
            {shareTypeName !== undefined ||
            c.complexSidebarKey === c.longTermSidebarKey
              ? t("commissioning.long_term_planning_of", {
                  label: shareTypeName ?? t(c.longTermSidebarKey),
                })
              : t(c.longTermSidebarKey)}
          </Link>
        ),
      };
    },
  );
  const additionalLongTermItems: RoleGatedItem[] = simplePlanningOptions.map(
    (c) => ({
      key: `commissioning-planning-${c.slug}-long-term`,
      requireRole: "isOffice",
      label: (
        <Link to={`/commissioning/planning/${c.slug}/long-term`}>
          {nameByOption.get(c.shareOption) ?? t(c.longTermSidebarKey)}
        </Link>
      ),
    }),
  );

  return {
    planningComplexItems,
    planningLongTermItems,
    additionalLongTermItems,
  };
}
