import { of } from 'rxjs';
import { NotificationStatus, NotificationType } from '@slack/constants';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const execute = jest.fn();
  const values = jest.fn();
  const queryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values,
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute,
  };
  const repository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    findBy: jest.fn(),
  };
  const userClient = { send: jest.fn(() => of({})) };
  const queueService = { addJob: jest.fn() };
  const service = new NotificationService(
    repository as never,
    userClient as never,
    queueService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilder.insert.mockReturnThis();
    queryBuilder.into.mockReturnThis();
    queryBuilder.orIgnore.mockReturnThis();
    queryBuilder.returning.mockReturnThis();
    values.mockReturnValue(queryBuilder);
    execute.mockResolvedValue({ raw: [] });
  });

  it('keeps distinct dedupe keys for legitimate events targeting the same object', async () => {
    await service.pushNotificationsBatch([
      {
        recipientId: '00000000-0000-4000-8000-000000000001',
        type: NotificationType.TASK_ASSIGNED,
        templateKey: NotificationType.TASK_ASSIGNED,
        objectId: 'task-1',
        objectType: 'task',
        dedupeKey: 'task-assigned:assignment-1',
        metadata: {
          actorId: 'user-2',
          actorName: 'Assigner',
          taskId: 'task-1',
          taskTitle: 'Task 1',
        },
      },
      {
        recipientId: '00000000-0000-4000-8000-000000000001',
        type: NotificationType.TASK_DUE_SOON,
        templateKey: NotificationType.TASK_DUE_SOON,
        objectId: 'task-1',
        objectType: 'task',
        dedupeKey: 'task-due-soon:task-1:2026-09-02T00:00:00.000Z',
      },
    ]);

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        objectId: 'task-1',
        dedupeKey: 'task-assigned:assignment-1',
        status: NotificationStatus.UNREAD,
      }),
      expect.objectContaining({
        objectId: 'task-1',
        dedupeKey: 'task-due-soon:task-1:2026-09-02T00:00:00.000Z',
        status: NotificationStatus.UNREAD,
      }),
    ]);
  });
});
