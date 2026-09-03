import { useId, useMemo, useState } from "react";
import type { SkeletonAnimationMetadata } from "@/lib/spine/bridge-types";

export interface AnimationPanelProps {
  animations: SkeletonAnimationMetadata[];
  selectedAnimation: string | null;
  disabled?: boolean;
  onSelect: (animation: SkeletonAnimationMetadata) => void;
}

export function AnimationPanel({
  animations,
  selectedAnimation,
  disabled = false,
  onSelect,
}: AnimationPanelProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const filteredAnimations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? animations.filter(({ name }) => name.toLocaleLowerCase().includes(normalized))
      : animations;
  }, [animations, query]);

  return (
    <section className="control-section" aria-label="动画列表">
      <label htmlFor={searchId}>搜索动画</label>
      <input
        id={searchId}
        className="search-input"
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="control-list">
        {filteredAnimations.map((animation) => (
          <button
            key={animation.name}
            type="button"
            className="list-button"
            aria-label={animation.name}
            aria-pressed={selectedAnimation === animation.name}
            disabled={disabled}
            onClick={() => onSelect(animation)}
          >
            <span>{animation.name}</span>
            <span className="duration">{animation.duration.toFixed(2)}s</span>
          </button>
        ))}
        {filteredAnimations.length === 0 && <p className="empty-copy">没有匹配的动画。</p>}
      </div>
    </section>
  );
}
