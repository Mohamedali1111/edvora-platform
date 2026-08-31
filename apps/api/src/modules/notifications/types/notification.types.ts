import type { NotificationCategory } from '../../../../.generated/prisma/client';

export type NotificationSummary = {
  notificationId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  domainEntityType: string | null;
  domainEntityId: string | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
};
