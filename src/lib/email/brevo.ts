import type { EmailConfig } from "./config";

// The only module that knows Brevo exists. Plain fetch, no SDK — the runtime
// is workerd, and the payload is a single JSON POST.
// Contract: https://developers.brevo.com/docs/send-a-transactional-email

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export type BrevoSendResult = { ok: true; messageId: string } | { ok: false; error: string };

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

/** Never throws — non-2xx responses and thrown fetch errors map to { ok: false }. */
export async function sendViaBrevo(config: EmailConfig, msg: EmailMessage): Promise<BrevoSendResult> {
  try {
    const response = await fetch(BREVO_SEND_URL, {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: config.fromName, email: config.fromEmail },
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `Brevo responded ${response.status}: ${text}` };
    }
    const data = (await response.json()) as { messageId?: string };
    return { ok: true, messageId: data.messageId ?? "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
