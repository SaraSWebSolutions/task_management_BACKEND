const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendCampaignEmail } = require("../utils/mailer");
const { permissionsFor } = require("../utils/rbac");

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and Password are required",
      });
    }

    const user = await User.findOne({ email });

    if (!user){
      return res.status(400).json({
        message: "User not found",
      });
    }

    if (user.status === "INACTIVE") {
      return res.status(403).json({
        message: "Your account is inactive. Contact Admin.",
      });
    }

    const match = await bcrypt.compare(
      password,
      user.password
    );

    if (!match)
      return res.status(400).json({
        message: "Invalid Email or Password",
      });

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    User.updateOne({ _id: user._id }, { lastLoginAt: new Date() }).catch(() => {});

    const permissions = await permissionsFor(user);

    const userData = {
      _id: user._id,
      employeeId: user.employeeId,
      name: user.name,
      email: user.email,
      role: user.role,
      designation: user.designation,
      department: user.department,
      phone: user.phone,
      status: user.status,
      profileImage: user.profileImage,
      roleKey: user.roleKey || user.role,
    };

    res.status(200).json({
      token,
      user: userData,
      permissions,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Server Error",
    });
  }
};

/* ---------------- Forgot / reset password ---------------- */

const RESET_TTL_MS = 30 * 60 * 1000; // link valid for 30 minutes
const RESEND_GAP_MS = 60 * 1000; // at most one email per minute per user
const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The link must point at the real frontend. Never build it from request headers,
// otherwise anyone could make us email a victim a link to a different site.
const frontendUrl = () =>
  (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

const resetEmail = (name, link) => {
  const who = name ? `Hi ${name},` : "Hi,";

  const text =
    `${who}\n\n` +
    "We received a request to reset your SaraS Task Management password.\n" +
    `Open this link to choose a new password (valid for 30 minutes):\n${link}\n\n` +
    "If you did not request this, you can safely ignore this email.";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1e293b">
      <h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>
      <p style="margin:0 0 12px;line-height:1.6">${who}</p>
      <p style="margin:0 0 20px;line-height:1.6">
        We received a request to reset your SaraS Task Management password.
        This link is valid for 30 minutes.
      </p>
      <a href="${link}"
         style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:12px">
        Reset password
      </a>
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;line-height:1.6">
        Button not working? Copy this link into your browser:<br />
        <span style="word-break:break-all">${link}</span>
      </p>
      <p style="margin:20px 0 0;font-size:13px;color:#64748b">
        If you did not request this, you can safely ignore this email.
      </p>
    </div>`;

  return { text, html };
};

// POST /api/auth/forgot-password  { email }
// Always answers the same way so the endpoint can't be used to find out
// which emails are registered.
exports.forgotPassword = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({
      email: new RegExp(`^${escapeRegex(email)}$`, "i"),
    });

    if (user && user.status !== "INACTIVE") {
      const issuedAt = user.resetPasswordExpires
        ? user.resetPasswordExpires.getTime() - RESET_TTL_MS
        : 0;

      // Throttle: ignore repeat requests inside the resend gap.
      if (Date.now() - issuedAt >= RESEND_GAP_MS) {
        const token = crypto.randomBytes(32).toString("hex");

        await User.updateOne(
          { _id: user._id },
          {
            resetPasswordToken: hashToken(token),
            resetPasswordExpires: new Date(Date.now() + RESET_TTL_MS),
          },
        );

        const link = `${frontendUrl()}/reset-password/${token}`;
        const { text, html } = resetEmail(user.name, link);

        try {
          await sendCampaignEmail(
            user.email,
            "Reset your password",
            text,
            html,
          );
        } catch (mailError) {
          // Invalidate the unused token and keep the response generic.
          await User.updateOne(
            { _id: user._id },
            { $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 } },
          );
          console.error("Forgot password email failed:", mailError.message);
        }
      }
    }

    res.status(200).json({ message: GENERIC_MESSAGE });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

const findByResetToken = (token) =>
  User.findOne({
    resetPasswordToken: hashToken(String(token || "")),
    resetPasswordExpires: { $gt: new Date() },
    status: { $ne: "INACTIVE" },
  });

// GET /api/auth/reset-password/:token  -> is the link still usable?
exports.verifyResetToken = async (req, res) => {
  try {
    const user = await findByResetToken(req.params.token);

    if (!user) {
      return res
        .status(400)
        .json({ message: "This reset link is invalid or has expired" });
    }

    res.status(200).json({ valid: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};

// POST /api/auth/reset-password/:token  { password }
exports.resetPassword = async (req, res) => {
  try {
    const password = String(req.body?.password || "");

    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });
    }

    // bcrypt only looks at the first 72 bytes.
    if (Buffer.byteLength(password) > 72) {
      return res.status(400).json({ message: "Password is too long" });
    }

    const user = await findByResetToken(req.params.token);

    if (!user) {
      return res
        .status(400)
        .json({ message: "This reset link is invalid or has expired" });
    }

    if (user.password && (await bcrypt.compare(password, user.password))) {
      return res.status(400).json({
        message: "New password must be different from your current password",
      });
    }

    await User.updateOne(
      { _id: user._id },
      {
        password: await bcrypt.hash(password, 10),
        $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 },
      },
    );

    res.status(200).json({ message: "Password reset successful. Please sign in." });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server Error" });
  }
};
