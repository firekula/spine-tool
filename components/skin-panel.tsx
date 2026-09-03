import { useId, useMemo, useState } from "react";

export interface SkinPanelProps {
  skins: string[];
  mode: "single" | "combined";
  selectedSkins: string[];
  disabled?: boolean;
  onModeChange: (mode: "single" | "combined") => void;
  onSelectionChange: (skins: string[]) => void;
}

export function SkinPanel({
  skins,
  mode,
  selectedSkins,
  disabled = false,
  onModeChange,
  onSelectionChange,
}: SkinPanelProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const filteredSkins = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? skins.filter((skin) => skin.toLocaleLowerCase().includes(normalized)) : skins;
  }, [query, skins]);

  return (
    <section className="control-section" aria-label="皮肤列表">
      <fieldset className="mode-picker" disabled={disabled}>
        <legend>皮肤模式</legend>
        <label>
          <input
            type="radio"
            name="skin-mode"
            checked={mode === "single"}
            onChange={() => onModeChange("single")}
          />
          单一皮肤
        </label>
        <label>
          <input
            type="radio"
            name="skin-mode"
            checked={mode === "combined"}
            onChange={() => onModeChange("combined")}
          />
          组合皮肤
        </label>
      </fieldset>
      <label htmlFor={searchId}>搜索皮肤</label>
      <input
        id={searchId}
        className="search-input"
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="control-list">
        {filteredSkins.map((skin) => {
          const checked = selectedSkins.includes(skin);
          return (
            <label className="check-row" key={skin}>
              <input
                type={mode === "single" ? "radio" : "checkbox"}
                name={mode === "single" ? "skin" : undefined}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  if (mode === "single") {
                    onSelectionChange([skin]);
                    return;
                  }
                  onSelectionChange(
                    checked ? selectedSkins.filter((name) => name !== skin) : [...selectedSkins, skin],
                  );
                }}
              />
              {skin}
            </label>
          );
        })}
      </div>
    </section>
  );
}
