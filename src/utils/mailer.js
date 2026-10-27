// const nodemailer = require("nodemailer");

// const smtpPort = Number(process.env.SMTP_PORT || 465);
// const useSecureConnection = process.env.SMTP_SECURE === "true" || smtpPort === 465;

// const transporter = nodemailer.createTransport({
//   host: process.env.SMTP_HOST || "smtp.zoho.com",
//   port: smtpPort,
//   secure: useSecureConnection,
//   requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASS,
//   },
//   connectionTimeout: 10000,
//   greetingTimeout: 10000,
//   socketTimeout: 10000,
// });

// const sendCampaignEmail = async (to, subject, text, html) => {
//   const mailOptions = {
//     from: process.env.MAIL_FROM || `"SaraS" <${process.env.SMTP_USER}>`,
//     to,
//     subject,
//     text,
//     html,
//   };

//   try {
//     return await transporter.sendMail(mailOptions);
//   } catch (error) {
//     const details = error?.response || error?.message || "Unknown SMTP error";
//     throw new Error(`SMTP send failed: ${details}`);
//   }
// };

// module.exports = { sendCampaignEmail, transporter };

const nodemailer = require("nodemailer");

const smtpPort = Number(process.env.SMTP_PORT || 465);
const useSecureConnection =
  process.env.SMTP_SECURE === "true" || smtpPort === 465;

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  throw new Error("SMTP_USER and SMTP_PASS must be configured");
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.zoho.in",
  port: smtpPort,
  secure: useSecureConnection,

  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },

  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,
});

const sendCampaignEmail = async (to, subject, text, html) => {
  const mailOptions = {
    from:
      process.env.MAIL_FROM ||
      `"SaraS" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  };

  try {
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("SMTP send error:", {
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      message: error.message,
    });

    const details = error.message || "Unknown SMTP error";

    throw new Error(
      `SMTP send failed: ${details}`
    );
  }
};

const verifySMTP = async () => {
  try {
    await transporter.verify();
    console.log("SMTP connection and authentication verified");
    return true;
  } catch (error) {
    console.error("SMTP verification failed:", {
      code: error.code,
      command: error.command,
      message: error.message,
    });
    return false;
  }
};

module.exports = {
  sendCampaignEmail,
  transporter,
  verifySMTP,
};