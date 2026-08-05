export enum EApprovalAction {
  APPROVE = 'approve',
  REJECT = 'reject',
  CLARIFY = 'clarify',
  EDIT_AND_APPROVE = 'edit_and_approve',
}

export enum ECheckpointKind {
  APPROVAL = 'approval',
  CLARIFICATION = 'clarification',
}

export enum ECheckpointRiskLevel {
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum EStepExecutionStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  AWAITING_APPROVAL = 'awaiting_approval',
}

export enum EMessageRole {
  USER = 'user',
  MODEL = 'model',
}

export enum ERefreshFormat {
  FORM = 'form',
  JSON = 'json',
}

export enum ESupervisorVerdict {
  CONTINUE = 'continue',
  REPLAN = 'replan',
  FINALIZE = 'finalize',
  DONE = 'done',
}

export enum ECircuitBreaker {
  OPEN = 'open',
  HALF_OPEN = 'halfOpen',
  CLOSED = 'closed',
}
