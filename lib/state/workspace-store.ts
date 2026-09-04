import type { AppIssue } from "@/lib/issues/types";
import type { PlaybackSnapshot } from "@/lib/spine/bridge-types";
import type {
  RuntimeCompatibility,
  SupportedSpineVersion,
} from "@/lib/spine/runtime-registry";

export type WorkspacePhase = "empty" | "loading" | "ready" | "error";
export type RuntimeSelectionSource = "automatic" | "manual";

export interface WorkspaceState {
  phase: WorkspacePhase;
  speed: number;
  selectedAnimation: string | null;
  selectedSkins: string[];
  skinMode: "single" | "combined";
  hiddenSlots: Set<string>;
  loop: boolean;
  paused: boolean;
  playback: PlaybackSnapshot;
  seekRequest: { id: number; time: number } | null;
  warnings: AppIssue[];
  rawVersion: string | null;
  runtimeVersion: SupportedSpineVersion | null;
  selectionSource: RuntimeSelectionSource | null;
  compatibility: RuntimeCompatibility | null;
}

export type WorkspaceAction =
  | { type: "IMPORT_STARTED" }
  | { type: "IMPORT_SUCCEEDED" }
  | { type: "IMPORT_FAILED"; issue: AppIssue }
  | { type: "REPORT_ISSUE"; issue: AppIssue }
  | {
      type: "IMPORT_VERSION_IDENTIFIED";
      rawVersion: string | null;
      runtimeVersion: SupportedSpineVersion | null;
      selectionSource: RuntimeSelectionSource | null;
      compatibility: RuntimeCompatibility | null;
    }
  | {
      type: "RUNTIME_SELECTED";
      runtimeVersion: SupportedSpineVersion;
      selectionSource: RuntimeSelectionSource;
    }
  | {
      type: "INITIALIZE_CONTROLS";
      animation: string | null;
      duration: number;
      skin: string | null;
    }
  | { type: "SELECT_ANIMATION"; animation: string | null; duration?: number }
  | { type: "SET_SPEED"; speed: number }
  | { type: "SET_LOOP"; loop: boolean }
  | { type: "SET_PAUSED"; paused: boolean }
  | { type: "SET_SKIN_MODE"; mode: "single" | "combined" }
  | { type: "SET_SKINS"; skins: string[] }
  | { type: "TOGGLE_SLOT"; slot: string }
  | { type: "SET_HIDDEN_SLOTS"; slots: ReadonlySet<string> }
  | { type: "SEEK"; time: number }
  | { type: "SYNC_PLAYBACK"; snapshot: PlaybackSnapshot };

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    phase: "empty",
    speed: 1,
    selectedAnimation: null,
    selectedSkins: [],
    skinMode: "single",
    hiddenSlots: new Set(),
    loop: true,
    paused: false,
    playback: { animation: null, duration: 0, playing: false, time: 0 },
    seekRequest: null,
    warnings: [],
    rawVersion: null,
    runtimeVersion: null,
    selectionSource: null,
    compatibility: null,
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "IMPORT_STARTED":
      return {
        ...state,
        phase: "loading",
        selectedAnimation: null,
        selectedSkins: [],
        skinMode: "single",
        hiddenSlots: new Set(),
        paused: false,
        playback: { animation: null, duration: 0, playing: false, time: 0 },
        seekRequest: null,
        warnings: [],
        rawVersion: null,
        runtimeVersion: null,
        selectionSource: null,
        compatibility: null,
      };
    case "IMPORT_SUCCEEDED":
      return { ...state, phase: "ready" };
    case "IMPORT_FAILED":
      return { ...state, phase: "error", warnings: [...state.warnings, action.issue] };
    case "REPORT_ISSUE":
      return { ...state, warnings: [...state.warnings, action.issue] };
    case "IMPORT_VERSION_IDENTIFIED":
      return {
        ...state,
        rawVersion: action.rawVersion,
        runtimeVersion: action.runtimeVersion,
        selectionSource: action.selectionSource,
        compatibility: action.compatibility,
      };
    case "RUNTIME_SELECTED":
      return {
        ...state,
        runtimeVersion: action.runtimeVersion,
        selectionSource: action.selectionSource,
      };
    case "INITIALIZE_CONTROLS":
      return {
        ...state,
        phase: "ready",
        selectedAnimation: action.animation,
        selectedSkins: action.skin ? [action.skin] : [],
        skinMode: "single",
        hiddenSlots: new Set(),
        paused: false,
        playback: {
          animation: action.animation,
          duration: action.duration,
          playing: action.animation !== null,
          time: 0,
        },
        seekRequest: null,
      };
    case "SELECT_ANIMATION":
      return {
        ...state,
        selectedAnimation: action.animation,
        paused: false,
        playback: {
          animation: action.animation,
          duration: action.duration ?? state.playback.duration,
          playing: action.animation !== null,
          time: 0,
        },
      };
    case "SET_SPEED":
      return { ...state, speed: action.speed };
    case "SET_LOOP":
      return { ...state, loop: action.loop };
    case "SET_PAUSED":
      return {
        ...state,
        paused: action.paused,
        playback: { ...state.playback, playing: !action.paused && state.selectedAnimation !== null },
      };
    case "SET_SKIN_MODE":
      return { ...state, skinMode: action.mode };
    case "SET_SKINS":
      return { ...state, selectedSkins: [...action.skins] };
    case "TOGGLE_SLOT": {
      const hiddenSlots = new Set(state.hiddenSlots);
      if (hiddenSlots.has(action.slot)) {
        hiddenSlots.delete(action.slot);
      } else {
        hiddenSlots.add(action.slot);
      }
      return { ...state, hiddenSlots };
    }
    case "SET_HIDDEN_SLOTS":
      return { ...state, hiddenSlots: new Set(action.slots) };
    case "SEEK":
      return {
        ...state,
        playback: { ...state.playback, time: action.time },
        seekRequest: { id: (state.seekRequest?.id ?? 0) + 1, time: action.time },
      };
    case "SYNC_PLAYBACK":
      return { ...state, playback: action.snapshot };
  }
}
