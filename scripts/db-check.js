const { PrismaClient } = require("@prisma/client");

function sanitizeDbUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.password) {
      url.password = "****";
    }
    return url.toString();
  } catch (error) {
    return "";
  }
}

function parseHost(raw) {
  try {
    return new URL(raw).hostname || "";
  } catch (error) {
    return "";
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || "";
  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing.");
  }
  if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
    throw new Error("DATABASE_URL must start with postgres:// or postgresql://");
  }

  const host = parseHost(dbUrl);
  const looksLikeSupabase =
    host.includes("supabase.co") || host.includes("supabase.com") || host.includes("pooler.supabase");

  console.log("DATABASE_URL:", sanitizeDbUrl(dbUrl));
  console.log("DB host:", host || "(unknown)");
  console.log("Looks like Supabase:", looksLikeSupabase ? "yes" : "no");

  const prisma = new PrismaClient();
  try {
    const dbInfo = await prisma.$queryRaw`
      select
        current_database() as database_name,
        current_user as db_user,
        now() as server_time
    `;
    console.log("DB info:", dbInfo);

    const importantColumns = await prisma.$queryRaw`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('users', 'orders', 'client_profiles', 'subscriptions')
      order by table_name, ordinal_position
    `;
    console.log("Core columns:", importantColumns.length);

    const cancelColumns = await prisma.$queryRaw`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'subscriptions'
        and column_name in ('cancel_at_period_end', 'canceled_at', 'cancel_reason')
      order by column_name
    `;
    console.log("Subscription cancel columns:", cancelColumns);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("db:check failed:", error.message);
  process.exit(1);
});
