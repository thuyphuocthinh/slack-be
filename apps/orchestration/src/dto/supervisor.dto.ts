export class AvailableAgentDto {
  provider: string;
  label: string;
  description: string;
}

export class SupervisorDecisionDto {
  action: 'respond' | 'delegate';
  answer?: string;
  agent?: string;
  task?: string;
}

/** 1 vòng delegate đã chạy xong trong turn hiện tại — đưa lại cho Supervisor
 * ở vòng quyết định tiếp theo để nó biết đã làm gì, kết quả ra sao. */
export class SupervisorRoundDto {
  agent: string;
  task: string;
  result: string;
}
