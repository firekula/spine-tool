import { Pause, Play } from "lucide-react";
import type { PlaybackSnapshot } from "@/lib/spine/bridge-types";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export interface PlaybackBarProps {
  disabled: boolean;
  paused: boolean;
  loop: boolean;
  speed: number;
  snapshot: PlaybackSnapshot;
  onPausedChange: (paused: boolean) => void;
  onLoopChange: (loop: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (time: number) => void;
}

export function PlaybackBar({
  disabled,
  paused,
  loop,
  speed,
  snapshot,
  onPausedChange,
  onLoopChange,
  onSpeedChange,
  onSeek,
}: PlaybackBarProps) {
  return (
    <footer className="playback-bar" aria-label="播放控制">
      <button
        type="button"
        className="icon-button"
        aria-label="播放"
        disabled={disabled || !paused}
        onClick={() => onPausedChange(false)}
      >
        <Play size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="暂停"
        disabled={disabled || paused}
        onClick={() => onPausedChange(true)}
      >
        <Pause size={18} aria-hidden="true" />
      </button>
      <label className="loop-control">
        <input
          type="checkbox"
          checked={loop}
          disabled={disabled}
          onChange={(event) => onLoopChange(event.currentTarget.checked)}
        />
        循环播放
      </label>
      <label>
        速度
        <select
          aria-label="速度"
          value={speed}
          disabled={disabled}
          onChange={(event) => onSpeedChange(Number(event.currentTarget.value))}
        >
          {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
      <output aria-live="off">{formatTime(snapshot.time)} / {formatTime(snapshot.duration)}</output>
      <input
        aria-label="动画进度"
        type="range"
        min="0"
        max={Math.max(0, snapshot.duration)}
        step="0.001"
        value={Math.min(snapshot.time, snapshot.duration)}
        disabled={disabled || snapshot.duration <= 0}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
      />
    </footer>
  );
}
