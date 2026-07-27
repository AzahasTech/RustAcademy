import { Injectable } from '@nestjs/common';
import { Notification } from './interfaces/notifications.interface';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { LocalizationService } from '../i18n/localization.service';

@Injectable()
export class NotificationsService {
  private notifications: Notification[] = [];
  private preferences: Map<string, NotificationPreferences> = new Map();

  // ── Default localized notification templates ────────────────
  static readonly TEMPLATES: Record<string, { titleKey: keyof import('../i18n/localization.service').LocalizationStrings; messageKey: keyof import('../i18n/localization.service').LocalizationStrings }> = {
    welcome: {
      titleKey: 'notification.welcome',
      messageKey: 'notification.welcome',
    },
    milestone: {
      titleKey: 'notification.milestone',
      messageKey: 'notification.milestone',
    },
    submissionGraded: {
      titleKey: 'notification.submissionGraded',
      messageKey: 'notification.submissionGraded',
    },
    courseCompleted: {
      titleKey: 'notification.courseCompleted',
      messageKey: 'notification.courseCompleted',
    },
    contentFlagged: {
      titleKey: 'notification.contentFlagged',
      messageKey: 'notification.contentFlagged',
    },
    contentApproved: {
      titleKey: 'notification.contentApproved',
      messageKey: 'notification.contentApproved',
    },
    contentRejected: {
      titleKey: 'notification.contentRejected',
      messageKey: 'notification.contentRejected',
    },
  };

  constructor(private readonly l10n: LocalizationService) {}

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

  /**
   * Creates a localized notification using a predefined template.
   */
  createLocalized(
    userId: string,
    templateName: keyof typeof NotificationsService.TEMPLATES,
    type: 'push' | 'in-app' = 'in-app',
  ): Notification {
    const template = NotificationsService.TEMPLATES[templateName];
    if (!template) {
      throw new Error(`Unknown notification template: ${templateName}`);
    }
    return this.create({
      userId,
      type,
      title: this.l10n.t(template.titleKey),
      message: this.l10n.t(template.messageKey),
    });
  }
}
