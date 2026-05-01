import { Controller, Get, Patch, Delete, Param, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { FetchNotificationsDto } from './dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '@slack/common';

@Controller('notifications')
@ApiTags('Notifications')
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @ApiOperation({ summary: 'Get unread notifications summary' })
  @ApiResponse({ status: 200, description: 'Unread summary retrieved' })
  @Get('unread')
  async getUnreadSummary(@CurrentUser() user: JwtUser) {
    return await this.notificationService.getUnreadSummary(user.sub);
  }

  @ApiOperation({ summary: 'Fetch notifications' })
  @ApiResponse({
    status: 200,
    description: 'Notifications retrieved successfully',
  })
  @Get()
  async fetchNotifications(
    @Query() dto: FetchNotificationsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.notificationService.fetchNotifications(user.sub, dto);
  }

  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  @Patch('read-all')
  async markAllAsRead(
    @CurrentUser() user: JwtUser,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return await this.notificationService.markAllAsRead(user.sub, workspaceId);
  }

  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return await this.notificationService.markAsRead(user.sub, id);
  }

  @ApiOperation({ summary: 'Delete notification' })
  @ApiResponse({ status: 200, description: 'Notification deleted' })
  @Delete(':id')
  async deleteNotification(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return await this.notificationService.deleteNotification(user.sub, id);
  }
}
