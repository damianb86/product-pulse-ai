import nodemailer from "nodemailer";

const APP_NAME = "ProductPulse AI";
const DEFAULT_FROM_EMAIL = "noreply@zuam.dev";
const DEFAULT_FROM_NAME = "Zuam ProductPulse";

function getSmtpConfig() {
  const port = Number(process.env.EMAIL_PORT ?? 587);

  return {
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    recipient: process.env.CONTACT_EMAIL,
    fromEmail: process.env.EMAIL_FROM ?? DEFAULT_FROM_EMAIL,
    fromName: process.env.EMAIL_FROM_NAME ?? DEFAULT_FROM_NAME,
  };
}

export async function sendContactEmail({
  type,
  subject,
  message,
  html,
  replyEmail,
  shop,
}) {
  return sendProductPulseEmail({
    type,
    subject,
    message: [
      `Reply email: ${replyEmail ?? "not provided"}`,
      "",
      message,
    ].join("\n"),
    html,
    replyEmail,
    shop,
    to: getSmtpConfig().recipient,
    requiredRecipientEnv: "CONTACT_EMAIL",
  });
}

export async function sendProductPulseEmail({
  type,
  subject,
  message,
  html,
  replyEmail,
  shop,
  to,
  requiredRecipientEnv = "email recipient",
}) {
  const smtp = getSmtpConfig();
  const recipients = normalizeEmailRecipients(to);
  const payload = {
    app: APP_NAME,
    type,
    subject,
    message,
    replyEmail,
    shop,
    recipient: recipients.join(", "),
    recipients,
  };

  const missing = [
    [requiredRecipientEnv, recipients.length ? recipients.join(", ") : ""],
    ["EMAIL_HOST", smtp.host],
    ["EMAIL_USER", smtp.user],
    ["EMAIL_PASS", smtp.pass],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Missing email configuration: ${missing.join(", ")}`);
    }

    console.log(
      "[email.server] SMTP not configured; email not sent:",
      payload,
    );
    return payload;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  await transporter.sendMail({
    from: { name: smtp.fromName, address: smtp.fromEmail },
    to: recipients,
    replyTo: replyEmail,
    subject: `[${APP_NAME}] ${subject || type}`,
    text: [
      `App: ${APP_NAME}`,
      `Shop: ${shop}`,
      `Type: ${type}`,
      "",
      message,
    ].join("\n"),
    html,
    headers: {
      "X-Product-Pulse-Shop": shop,
      "X-Product-Pulse-Type": type,
    },
  });

  return payload;
}

function normalizeEmailRecipients(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[,\n;]/)
      .map((item) => item.trim());
  return [...new Set(values.filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}
