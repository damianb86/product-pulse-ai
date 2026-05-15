import nodemailer from "nodemailer";

const APP_NAME = "ProductPulse AI";

function getSmtpConfig() {
  const port = Number(process.env.EMAIL_PORT ?? 587);

  return {
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    recipient: process.env.CONTACT_EMAIL,
  };
}

export async function sendContactEmail({
  type,
  subject,
  message,
  replyEmail,
  shop,
}) {
  const smtp = getSmtpConfig();
  const payload = {
    app: APP_NAME,
    type,
    subject,
    message,
    replyEmail,
    shop,
    recipient: smtp.recipient,
  };

  const missing = [
    ["CONTACT_EMAIL", smtp.recipient],
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
      "[email.server] SMTP not configured; contact email not sent:",
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
    from: smtp.user,
    to: smtp.recipient,
    replyTo: replyEmail,
    subject: `[${APP_NAME}] ${subject || type}`,
    text: [
      `App: ${APP_NAME}`,
      `Shop: ${shop}`,
      `Type: ${type}`,
      `Reply email: ${replyEmail ?? "not provided"}`,
      "",
      message,
    ].join("\n"),
    headers: {
      "X-Product-Pulse-Shop": shop,
      "X-Product-Pulse-Type": type,
    },
  });

  return payload;
}
