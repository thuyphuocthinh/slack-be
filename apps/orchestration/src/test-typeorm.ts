
import { Repository } from "typeorm";

export interface PendingToolCall {
  provider: string;
  name: string;
  args: Record<string, unknown>;
}

export class Checkpoint {
  id: string;
  status: string;
  selectedProvider?: string;
  pendingTool: PendingToolCall | null;
}

const repo = {} as Repository<Checkpoint>;
const dto = { toStatus: "a", selectedProvider: "b", updatedPendingTool: { provider: "a", name: "b", args: {} } as PendingToolCall | null };

const updatePayload: Parameters<typeof repo.update>[1] = {
  status: dto.toStatus,
};
if (dto.selectedProvider !== undefined) {
  updatePayload.selectedProvider = dto.selectedProvider;
}
if (dto.updatedPendingTool !== undefined) {
  Object.assign(updatePayload, { pendingTool: dto.updatedPendingTool });
}

repo.update(
  { id: "1" },
  updatePayload
);

