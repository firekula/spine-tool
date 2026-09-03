import { CircleAlert, Lightbulb, TriangleAlert } from "lucide-react";
import type { AppIssue } from "@/lib/issues/types";
import { getIssueMessage } from "@/lib/ui/messages";

export interface StatusCenterProps {
  issues: AppIssue[];
}

export function StatusCenter({ issues }: StatusCenterProps) {
  if (issues.length === 0) return null;

  return (
    <section className="status-center" role="region" aria-label="问题中心">
      <div className="status-center-heading">
        <h2>问题中心</h2>
        <span>{issues.length} 项</span>
      </div>
      <div className="issue-list">
        {issues.map((issue, index) => {
          const message = getIssueMessage(issue);
          const error = issue.severity === "error";
          return (
            <article className={`issue-card issue-${issue.severity}`} key={`${issue.code}-${issue.subject ?? ""}-${index}`}>
              <header>
                {error
                  ? <CircleAlert size={17} aria-hidden="true" />
                  : <TriangleAlert size={17} aria-hidden="true" />}
                <strong>{message.title}</strong>
                <span className="issue-severity">{error ? "错误" : "警告"}</span>
              </header>
              {issue.subject && <p className="issue-subject"><span>对象</span>{issue.subject}</p>}
              <p>{message.reason}</p>
              {issue.details && issue.details.length > 0 && (
                <ul className="issue-details">
                  {issue.details.map((detail, detailIndex) => <li key={`${detail}-${detailIndex}`}>{detail}</li>)}
                </ul>
              )}
              <p className="issue-action"><Lightbulb size={15} aria-hidden="true" /><span>{message.action}</span></p>
              <code className="issue-code">{issue.code}</code>
            </article>
          );
        })}
      </div>
    </section>
  );
}
