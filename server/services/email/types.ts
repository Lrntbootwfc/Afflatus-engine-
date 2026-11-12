/** Shared types for the transactional email system. */

export type EmailJobStatus =
  | 'pending'
  | 'processing'
  | 'accepted'
  | 'delivered'
  | 'bounced'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type EmailEventType =
  | 'join_application_submitted'
  | 'join_application_approved'
  | 'join_application_rejected'
  | 'connection_request'
  | 'connection_accepted'
  | 'connection_declined'
  | 'message_request';

export type EmailTemplateId =
  | 'join_application_admin'
  | 'join_application_approved'
  | 'join_application_rejected'
  | 'connection_request'
  | 'connection_accepted'
  | 'connection_declined'
  | 'message_request';

export interface EmailJob {
  id: string;
  eventType: EmailEventType;
  recipientUserId: string;
  recipientEmail: string;
  templateId: EmailTemplateId;
  templateData: Record<string, string>;
  status: EmailJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  deliveredAt?: string;
  providerMessageId?: string;
  lastError?: string;
  idempotencyKey: string;
  processingStartedAt?: string;
  leaseExpiresAt?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface ProviderSendResult {
  accepted: boolean;
  messageId?: string;
  error?: string;
  retryable?: boolean;
  statusCode?: number;
}

export interface EnqueueEmailInput {
  eventType: EmailEventType;
  recipientUserId: string;
  recipientEmail: string;
  templateId: EmailTemplateId;
  templateData: Record<string, string>;
  idempotencyKey: string;
  maxAttempts?: number;
}
