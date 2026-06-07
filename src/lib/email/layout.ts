// Minimal shared branded wrapper so S-03/S-04/S-05 emails look consistent.
// Table-based, inline-styled HTML (email-client-safe), no external
// images/fonts. Polish copy — HTML-only emails at MVP.

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderEmailLayout(opts: { title: string; bodyHtml: string }): string {
  const title = escapeHtml(opts.title);
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f1;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f1;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background-color:#2d5a27;padding:20px 32px;">
<span style="color:#ffffff;font-size:20px;font-weight:bold;">Zagroda Hub</span>
</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:18px;color:#1a1a1a;">${title}</h1>
<div style="font-size:14px;line-height:1.6;color:#333333;">
${opts.bodyHtml}
</div>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e5e5e0;">
<p style="margin:0;font-size:12px;color:#888888;">
Ta wiadomość została wysłana automatycznie przez Zagroda Hub. Prosimy na nią nie odpowiadać.
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
