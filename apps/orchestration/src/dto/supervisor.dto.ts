export class AvailableAgentDto {
  provider: string;
  label: string;
  description: string;
}

export class DelegationDto {
  agent: string;
  task: string;
}

export class SupervisorDecisionDto {
  action: 'respond' | 'delegate';
  answer?: string;
  // Nhiều phần tử = các agent ĐỘC LẬP nhau, chạy song song trong CÙNG 1 vòng
  // (Step 8 — fan-out). Phần việc phụ thuộc kết quả phần khác phải để vòng sau.
  delegations?: DelegationDto[];
}

/** 1 vòng delegate đã chạy xong trong turn hiện tại — đưa lại cho Supervisor
 * ở vòng quyết định tiếp theo để nó biết đã làm gì, kết quả ra sao. */
export class SupervisorRoundDto {
  agent: string;
  task: string;
  result: string;
}
