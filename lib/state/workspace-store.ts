import type { AppIssue } from "@/lib/issues/types";

export type WorkspacePhase = "empty" | "loading" | "ready" | "error";

export interface WorkspaceState {
  phase: WorkspacePhase;
  speed: number;
  selectedAnimation: string | null;
  hiddenSlots: Set<string>;
  warnings: AppIssue[];
}

export type WorkspaceAction =
  | { type: "IMPORT_STARTED" }
  | { type: "IMPORT_SUCCEEDED" }
  | { type: "IMPORT_FAILED"; issue: AppIssue }
  | { type: "SELECT_ANIMATION"; animation: string | null }
  | { type: "SET_SPEED"; speed: number }
  | { type: "TOGGLE_SLOT"; slot: string };

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    phase: "empty",
    speed: 1,
    selectedAnimation: null,
    hiddenSlots: new Set(),
    warnings: [],
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
        hiddenSlots: new Set(),
        warnings: [],
      };
    case "IMPORT_SUCCEEDED":
      return { ...state, phase: "ready" };
    case "IMPORT_FAILED":
      return { ...state, phase: "error", warnings: [...state.warnings, action.issue] };
    case "SELECT_ANIMATION":
      return { ...state, selectedAnimation: action.animation };
    case "SET_SPEED":
      return { ...state, speed: action.speed };
    case "TOGGLE_SLOT": {
      const hiddenSlots = new Set(state.hiddenSlots);
      if (hiddenSlots.has(action.slot)) {
        hiddenSlots.delete(action.slot);
      } else {
        hiddenSlots.add(action.slot);
      }
      return { ...state, hiddenSlots };
    }
  }
}
