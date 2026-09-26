import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { useDashboardStore } from '../../store/dashboardStore';
import type { ApprovalDecision, ApprovalRequest, RiskLevel } from '../../types/domain';

const riskColorByName: Record<RiskLevel, string> = {
  low: 'var(--color-radar)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
  critical: 'var(--color-red)',
};

const decisionLabelByName: Record<ApprovalDecision, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

function ApprovalRow({ request }: { request: ApprovalRequest }): JSX.Element {
  const decideApprovalRequest = useDashboardStore((state) => state.decideApprovalRequest);

  return (
    <li className="status-item" aria-label={`Approval request ${request.missionName}`}>
      <div className="status-row">
        <strong>{request.missionName}</strong>
        <span
          className="badge"
          style={{ '--badge-color': riskColorByName[request.riskLevel], '--badge-border': riskColorByName[request.riskLevel] } as CSSProperties}
        >
          {request.riskLevel} risk
        </span>
      </div>
      <p className="helper-text">
        {request.operator} · escrow {request.creditsEscrowed} credits · filed {request.requestedAtIso.slice(0, 16).replace('T', ' ')} UTC
      </p>
      <p className="helper-text">{request.reason}</p>
      {request.status === 'pending' ? (
        <div className="approval-actions" role="group" aria-label={`Decision controls for ${request.missionName}`}>
          <button type="button" className="control-button" onClick={() => decideApprovalRequest(request.id, 'approved')}>
            Approve
          </button>
          <button type="button" className="control-button" onClick={() => decideApprovalRequest(request.id, 'rejected')}>
            Reject
          </button>
        </div>
      ) : (
        <p className="helper-text" role="status">
          Decision: <strong>{decisionLabelByName[request.status]}</strong>
        </p>
      )}
    </li>
  );
}

export function ApprovalsQueuePanel({ expanded = false }: { expanded?: boolean }): JSX.Element {
  const approvalRequests = useDashboardStore((state) => state.approvalRequests);
  const lastError = useDashboardStore((state) => state.lastError);
  const pendingCount = approvalRequests.filter((request) => request.status === 'pending').length;

  return (
    <section className="panel" aria-labelledby="approvals-queue-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Admin credit-controlled clearances</p>
          <h2 className="panel__title" id="approvals-queue-title">
            {expanded ? 'Approvals queue' : 'Approvals'}
          </h2>
        </div>
        <span className="badge" style={{ '--badge-color': 'var(--color-amber)' } as CSSProperties}>
          {pendingCount} pending
        </span>
      </div>

      {approvalRequests.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No approval requests"
          message="Escrowed flight requests filed by operators appear here for review."
        />
      ) : (
        <ul className="status-list" aria-label="Approval requests">
          {approvalRequests.map((request: ApprovalRequest) => (
            <ApprovalRow key={request.id} request={request} />
          ))}
        </ul>
      )}

      {lastError && (
        <EmptyState
          compact
          headingLevel={3}
          variant="error"
          title="Approval action failed"
          message={lastError}
        />
      )}
      {expanded && (
        <p className="helper-text spaced-top">
          Approving burns the escrowed credits; rejecting refunds them to the operator wallet. Every decision is
          appended to the credit ledger for the M3 audit trail.
        </p>
      )}
    </section>
  );
}
