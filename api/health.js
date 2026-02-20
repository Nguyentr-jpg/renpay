const { PrismaClient } = require("@prisma/client");

let prisma;

function getPrisma() {
  if (!prisma) {
    const dbUrl = process.env.DATABASE_URL || "";
    if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
      throw new Error(
        "DATABASE_URL is not configured or invalid."
      );
    }
    prisma = new PrismaClient();
  }
  return prisma;
}

function parseDbHost(raw) {
  try {
    return new URL(String(raw || "")).hostname || "";
  } catch (error) {
    return "";
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const checks = {
    timestamp: new Date().toISOString(),
    database: { status: "unknown" },
    environment: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      DATABASE_HOST: parseDbHost(process.env.DATABASE_URL),
      DATABASE_LOOKS_SUPABASE:
        parseDbHost(process.env.DATABASE_URL).includes("supabase.co") ||
        parseDbHost(process.env.DATABASE_URL).includes("supabase.com") ||
        parseDbHost(process.env.DATABASE_URL).includes("pooler.supabase"),
    },
  };

  // Check database connection
  try {
    const db = getPrisma();
    const result = await db.$queryRaw`SELECT 1 as connected`;
    checks.database = { status: "connected", result };

    // Check if tables exist
    const userCount = await db.user.count();
    const orderCount = await db.order.count();
    checks.database.tables = {
      users: userCount,
      orders: orderCount,
    };
  } catch (error) {
    checks.database = {
      status: "error",
      error: error.message,
      code: error.code,
    };
  }

  const isHealthy = checks.database.status === "connected";

  return res.status(isHealthy ? 200 : 500).json({
    healthy: isHealthy,
    ...checks,
  });
};
