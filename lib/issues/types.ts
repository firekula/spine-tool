export interface AppIssue {
  code: string;
  severity: "warning" | "error";
  subject?: string;
  details?: string[];
}
