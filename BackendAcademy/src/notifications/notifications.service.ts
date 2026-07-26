import { Injectable } from '@nestjs/common';
import { Notification } from './interfaces/notifications.interface';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationPreferences } from './interfaces/preferences.interface';
import { UpdateNotificationPreferencesDto } from './dto/update-preferences.dto';

@Injectable()
export class NotificationsService {
  private notifications: Notification[] = [];
  private preferences: Map<string, NotificationPreferences> = new Map();

  create(createNotificationDto: CreateNotificationDto): Notification {
    const newNotification: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      ...createNotificationDto,
      isRead: false,
      createdAt: new Date(),
    };
    this.notifications.push(newNotification);
    return newNotification;
  }

  findAll(): Notification[] {
    return this.notifications;
  }

  findByUserId(userId: string): Notification[] {
    return this.notifications.filter(n => n.userId === userId);
  }

  upsertPreferences(userId: string, updateDto: UpdateNotificationPreferencesDto): NotificationPreferences {
    const existing = this.preferences.get(userId) || {
      userId,
      email_alerts: false,
      push_notifications: false,
      marketing_updates: false,
    };

    const updated = { ...existing, ...updateDto };
    this.preferences.set(userId, updated);
    return updated;
  }

  getPreferences(userId: string): NotificationPreferences {
    return this.preferences.get(userId) || {
      userId,
      email_alerts: false,
      push_notifications: false,
      marketing_updates: false,
    };
  }

  sendNewDeviceNotification(userId: string, deviceInfo: string): void {
    this.create({
      userId,
      title: 'New device login detected',
      message: `A new device was used to access your account: ${deviceInfo}. If this wasn't you, please secure your account immediately.`,
      type: 'security_alert',
    });
  }

  sendPrivilegeChangeNotification(
    userId: string,
    previousRole: string,
    newRole: string,
  ): void {
    this.create({
      userId,
      title: 'Account privilege changed',
      message: `Your account role was changed from ${previousRole} to ${newRole}.`,
      type: 'account_alert',
    });
  }
}
