/**
 * Backfill: seed AI Assistant bot user cho các workspace đã tồn tại từ trước
 * khi có tính năng AI Agent Channel (createWorkspace() chỉ seed bot cho
 * workspace MỚI, không tự chạy lại cho workspace cũ).
 *
 * Chạy 1 lần, an toàn để chạy lại nhiều lần (idempotent — bỏ qua workspace
 * đã có bot).
 *
 * Cách chạy (từ root apps/workspace, hoặc từ root slack-be):
 *   node -r ts-node/register -r tsconfig-paths/register apps/workspace/scripts/backfill-ai-bot.ts
 */
import { NestFactory } from '@nestjs/core';
import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatabaseModule } from '@slack/database';
import { WorkspaceEntity } from '../src/entity/workspace.entity';
import { WorkspaceMemberEntity } from '../src/entity/workspace_member.entity';
import { WorkspaceRoleEnum, MembershipStatus } from '../src/types/workspace.enum';
import { UserEntity, UserStatus } from '../../user/src/entity/user.entity';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([WorkspaceEntity, WorkspaceMemberEntity, UserEntity]),
  ],
})
class BackfillAiBotModule {}

async function bootstrap() {
  const logger = new Logger('BackfillAiBot');
  logger.log('Bootstrapping application context...');

  const app = await NestFactory.createApplicationContext(BackfillAiBotModule);

  const workspaceRepository = app.get<Repository<WorkspaceEntity>>(
    getRepositoryToken(WorkspaceEntity),
  );
  const memberRepository = app.get<Repository<WorkspaceMemberEntity>>(
    getRepositoryToken(WorkspaceMemberEntity),
  );
  const userRepository = app.get<Repository<UserEntity>>(
    getRepositoryToken(UserEntity),
  );

  const workspaces = await workspaceRepository.find();
  logger.log(`Found ${workspaces.length} workspace(s) to check.`);

  let created = 0;
  let skipped = 0;

  for (const workspace of workspaces) {
    const existingBotMember = await memberRepository
      .createQueryBuilder('member')
      .innerJoin(UserEntity, 'user', 'user.id = member.userId')
      .where('member.workspaceId = :workspaceId', { workspaceId: workspace.id })
      .andWhere('user.isBot = true')
      .getOne();

    if (existingBotMember) {
      skipped++;
      continue;
    }

    const botUser = userRepository.create({
      email: `ai-assistant+${workspace.id}@internal.bot`,
      status: UserStatus.ACTIVE,
      firstName: 'AI Assistant',
      isBot: true,
    });
    const savedBotUser = await userRepository.save(botUser);

    await memberRepository.insert({
      workspaceId: workspace.id,
      userId: savedBotUser.id,
      role: WorkspaceRoleEnum.MEMBER,
      status: MembershipStatus.ACTIVE,
    });

    created++;
    logger.log(`Seeded AI bot for workspace ${workspace.id} (${workspace.name})`);
  }

  logger.log(`Done. Created: ${created}, Skipped (already had bot): ${skipped}`);

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
