const nodemailer = require("nodemailer");

const smtpPort = Number(process.env.SMTP_PORT || 465);
const useSecureConnection = process.env.SMTP_SECURE === "true" || smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.zoho.com",
  port: smtpPort,
  secure: useSecureConnection,
  requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

const sendCampaignEmail = async (to, subject, text, html) => {
  const mailOptions = {
    from: process.env.MAIL_FROM || `"SaraS" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  };

  try {
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    const details = error?.response || error?.message || "Unknown SMTP error";
    throw new Error(`SMTP send failed: ${details}`);
  }
};

module.exports = { sendCampaignEmail, transporter };