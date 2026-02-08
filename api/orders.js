const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      return await handleGet(req, res);
    }
    if (req.method === "POST") {
      return await handlePost(req, res);
    }
    if (req.method === "PUT") {
      return await handlePut(req, res);
    }
    if (req.method === "DELETE") {
      return await handleDelete(req, res);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("API Error:", error);

    // User-friendly messages (don't expose raw DB details)
    const userMessage =
      error.code === "P1001"
        ? "Không kết nối được database. Vui lòng thử lại sau."
        : error.code === "P2021"
        ? "Database chưa được setup. Liên hệ admin."
        : error.code === "P1000"
        ? "Lỗi xác thực database. Liên hệ admin."
        : "Lỗi hệ thống. Vui lòng thử lại sau.";

    return res.status(500).json({
      error: userMessage,
      code: error.code,
    });
  }
};

async function handleGet(req, res) {
  const orders = await prisma.order.findMany({
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json({ success: true, orders });
}

async function handlePost(req, res) {
  const { orderName, totalCount, totalAmount, clientId, clientName, userEmail, items } = req.body;

  if (!orderName || totalCount == null || totalAmount == null) {
    return res.status(400).json({
      error: "Missing required fields: orderName, totalCount, totalAmount",
    });
  }

  if (!userEmail) {
    return res.status(400).json({ error: "Missing required field: userEmail" });
  }

  // Find or create user by email
  let user = await prisma.user.findUnique({ where: { email: userEmail } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: userEmail,
        name: userEmail.split("@")[0],
      },
    });
  }

  // Generate unique order number
  const orderNumber = `ORD-${Date.now()}`;

  // Create order with items in a transaction
  const order = await prisma.order.create({
    data: {
      orderNumber,
      orderName,
      totalCount: Number(totalCount),
      totalAmount: Number(totalAmount),
      status: "UNPAID",
      clientId: clientId || `CLI-${Math.floor(Math.random() * 90000 + 10000)}`,
      clientName: clientName || userEmail,
      userId: user.id,
      items: items && items.length > 0
        ? {
            create: items.map((item) => ({
              type: item.type || "",
              count: Number(item.count || 0),
              link: item.link || null,
              unitPrice: Number(item.unitPrice || 0),
            })),
          }
        : undefined,
    },
    include: { items: true },
  });

  return res.status(201).json({ success: true, order });
}

async function handlePut(req, res) {
  const { orderNumber, status, paidAt } = req.body;

  if (!orderNumber) {
    return res.status(400).json({ error: "Missing required field: orderNumber" });
  }

  const order = await prisma.order.findUnique({ where: { orderNumber } });
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  const updateData = {};
  if (status) updateData.status = status.toUpperCase();
  if (paidAt) updateData.paidAt = new Date(paidAt);

  const updated = await prisma.order.update({
    where: { orderNumber },
    data: updateData,
    include: { items: true },
  });

  return res.status(200).json({ success: true, order: updated });
}

async function handleDelete(req, res) {
  const { orderNumber } = req.body;

  if (!orderNumber) {
    return res.status(400).json({ error: "Missing required field: orderNumber" });
  }

  const order = await prisma.order.findUnique({ where: { orderNumber } });
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  await prisma.order.delete({ where: { orderNumber } });

  return res.status(200).json({ success: true, deleted: orderNumber });
}
