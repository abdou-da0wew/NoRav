import type { SettingRowProps } from "@/lib/types";

export function SettingRow({ icon, title, description, control }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-row-icon">{icon}</div>
      <div className="setting-row-copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="setting-row-control">{control}</div>
    </div>
  );
}
