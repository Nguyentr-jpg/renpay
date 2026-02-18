const { PrismaClient } = require("@prisma/client");

let prisma;

function getPrisma() {
  if (!prisma) {
    const dbUrl = process.env.DATABASE_URL || "";
    if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
      throw new Error(
        "DATABASE_URL is not configured. Please set it in your Vercel environment variables."
      );
    }
    prisma = new PrismaClient();
  }
  return prisma;
}

function getErrorHint(error) {
  if (!error) return "Unknown authentication error.";
  if (error.code === "P2021") {
    return "Subscriptions table is missing. Run 'npx prisma db push' against production database.";
  }
  if (error.code === "P2022") {
    return "Subscription columns are missing. Run 'npx prisma db push' then redeploy.";
  }
  if (error.code === "P1001") {
    return "Cannot reach database. Check DATABASE_URL in Vercel.";
  }
  if (error.code === "P1000") {
    return "Database authentication failed. Check DATABASE_URL credentials.";
  }
  return "Database query failed. Check database schema and environment variables.";
}

function envFlag(value) {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getAllowedEmails() {
  const raw = String(process.env.AUTH_ALLOWED_EMAILS || "").trim();
  if (!raw) return new Set();

  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Missing required field: email" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const db = getPrisma();

    const allowedEmails = getAllowedEmails();
    if (allowedEmails.size > 0 && !allowedEmails.has(normalizedEmail)) {
      return res.status(403).json({
        error: "This email is not allowed to sign in.",
        code: "EMAIL_NOT_ALLOWED",
      });
    }

    // Find existing user
    let user = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      if (!envFlag(process.env.AUTH_AUTO_SIGNUP)) {
        return res.status(401).json({
          error: "Account not found. Please contact admin to create your account.",
          code: "ACCOUNT_NOT_FOUND",
        });
      }

      user = await db.user.create({
        data: {
          email: normalizedEmail,
          name: normalizedEmail.split("@")[0],
          role: "CLIENT",
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
      });
    }

    // Check active subscription. Do not block login if subscription schema is not migrated yet.
    let subscription = null;
    let warning = null;
    try {
      subscription = await db.subscription.findFirst({
        where: {
          userId: user.id,
          status: "active",
          expiresAt: { gt: new Date() },
        },
        orderBy: { expiresAt: "desc" },
      });
    } catch (subscriptionError) {
      if (subscriptionError.code === "P2021" || subscriptionError.code === "P2022") {
        console.warn("Auth subscription lookup skipped due to schema mismatch:", subscriptionError.code);
        warning = getErrorHint(subscriptionError);
      } else {
        throw subscriptionError;
      }
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      },
      subscription: subscription ? {
        plan: subscription.plan,
        status: subscription.status,
        expiresAt: subscription.expiresAt,
      } : null,
      warning,
    });
  } catch (error) {
    console.error("Auth API Error:", error);
    return res.status(500).json({
      error: "Authentication failed",
      hint: getErrorHint(error),
      code: error.code || null,
    });
  }
};
