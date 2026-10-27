import { websiteConfig } from '@/config/website';
import { serverEnv } from '@/env/server';
import { getTemplate } from '../render';
import type {
  MailProvider,
  SendEmailResult,
  SendRawEmailParams,
  SendTemplateParams,
} from '@/mail/types';
import { Resend } from 'resend';
import { logOperationalEvent } from '@/lib/observability';

/**
 * Resend mail provider implementation.
 * https://resend.com/docs
 */
export class ResendProvider implements MailProvider {
  private resend: Resend;
  private from: string;

  constructor() {
    const apiKey = serverEnv.RESEND_API_KEY;
    const from = websiteConfig.mail?.fromEmail;
    if (!apiKey) throw new Error('RESEND_API_KEY is required.');
    if (!from) throw new Error('mail.fromEmail is required.');
    this.resend = new Resend(apiKey);
    this.from = from;
  }

  getProviderName(): string {
    return 'resend';
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendEmailResult> {
    const { to, template, context } = params;
    try {
      const mailTemplate = await getTemplate({ template, context });
      return this.sendRawEmail({
        to,
        subject: mailTemplate.subject,
        html: mailTemplate.html,
        text: mailTemplate.text,
      });
    } catch (error) {
      logOperationalEvent.error('mail.template_failed');
      return { success: false, error };
    }
  }

  async sendRawEmail(params: SendRawEmailParams): Promise<SendEmailResult> {
    const { to, subject, html, text } = params;
    if (!this.from || !to || !subject || !html) {
      logOperationalEvent.warn('Missing required fields for email send');
      return { success: false, error: 'Missing required fields' };
    }
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
        text,
      });
      if (error) {
        logOperationalEvent.error('mail.provider_rejected');
        return { success: false, error };
      }
      return { success: true, messageId: data?.id };
    } catch (error) {
      logOperationalEvent.error('mail.provider_failed');
      return { success: false, error };
    }
  }
}
