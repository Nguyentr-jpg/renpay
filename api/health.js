const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

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
    },
  };

  // Check database connection
  try {
    const result = await prisma.$queryRaw`SELECT 1 as connected`;
    checks.database = { status: "connected", result };

    // Check if tables exist
    const userCount = await prisma.user.count();
    const orderCount = await prisma.order.count();
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
