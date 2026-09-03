import { useId, useMemo, useState } from "react";

export interface SlotPanelProps {
  slots: string[];
  hiddenSlots: ReadonlySet<string>;
  disabled?: boolean;
  onToggle: (slot: string) => void;
  onHiddenSlotsChange: (slots: ReadonlySet<string>) => void;
}

export function SlotPanel({
  slots,
  hiddenSlots,
  disabled = false,
  onToggle,
  onHiddenSlotsChange,
}: SlotPanelProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const filteredSlots = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? slots.filter((slot) => slot.toLocaleLowerCase().includes(normalized)) : slots;
  }, [query, slots]);

  return (
    <section className="control-section" aria-label="插槽列表">
      <label htmlFor={searchId}>搜索插槽</label>
      <input
        id={searchId}
        className="search-input"
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="bulk-actions" aria-label="插槽批量操作">
        <button type="button" disabled={disabled} onClick={() => onHiddenSlotsChange(new Set())}>
          全选
        </button>
        <button type="button" disabled={disabled} onClick={() => onHiddenSlotsChange(new Set(slots))}>
          全不选
        </button>
        <button type="button" disabled={disabled} onClick={() => onHiddenSlotsChange(new Set())}>
          恢复默认
        </button>
      </div>
      <div className="control-list">
        {filteredSlots.map((slot) => (
          <label className="check-row" key={slot}>
            <input
              type="checkbox"
              checked={!hiddenSlots.has(slot)}
              disabled={disabled}
              onChange={() => onToggle(slot)}
            />
            {slot}
          </label>
        ))}
      </div>
    </section>
  );
}
