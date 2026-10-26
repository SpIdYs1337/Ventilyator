export interface MailConfiguration {
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpMode: 'TLS' | 'STARTTLS';
  smtpUser: string;
  senderEmail: string;
  senderName: string;
  smtpPasswordSet: boolean;
  imapEnabled: boolean;
  imapHost: string;
  imapPort: number;
  imapDomain: string | null;
  imapAutoCreate: boolean;
  imapRoleId: string | null;
}

export const defaultMailConfiguration: Readonly<MailConfiguration> = Object.freeze({
  smtpEnabled: false, smtpHost: '', smtpPort: 465, smtpMode: 'TLS', smtpUser: '',
  senderEmail: '', senderName: 'Ventilyator', smtpPasswordSet: false,
  imapEnabled: false, imapHost: '', imapPort: 993, imapDomain: null,
  imapAutoCreate: false, imapRoleId: null,
});
