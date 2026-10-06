import { SearchOutlined } from "@ant-design/icons";
import { Input } from "antd";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

/** The search box above an editable table, on a desktop or a phone. */
export default function TableSearchInput({
  value,
  onChange,
  mobile = false,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  mobile?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Input
      placeholder={t("table.search_placeholder")}
      aria-label={t("table.search_placeholder")}
      type="search"
      value={value}
      allowClear
      onChange={onChange}
      prefix={<SearchOutlined />}
      size={mobile ? "middle" : "small"}
      className={mobile ? "table-search-input table-search-input--mobile" : "table-search-input"}
    />
  );
}
