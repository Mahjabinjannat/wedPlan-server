import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import Stripe from "stripe";
import { z } from "zod";

const app = express();
const port = process.env.PORT || 8000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Premium plan settings (one-time payment, 30 days of Premium)
const PREMIUM_PRICE_CENTS = 1999; // $19.99
const PREMIUM_DAYS = 30;
const FREE_PLAN_SERVICE_LIMIT = 3;

const SERVICE_CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];

app.use(cors({ origin: clientUrl }));

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    throw error;
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db(process.env.DB_NAME || "wedplanDB");

// Collections
const users = database.collection("user");
const services = database.collection("services");
const transactions = database.collection("transactions");

const publicServiceFilter = {
  status: "approved",
  isActive: true,
};

// ==========================================
// STRIPE WEBHOOK
// ==========================================
// Must be registered BEFORE app.use(express.json()),
// because Stripe needs the raw request body to verify the signature.
// Premium is activated ONLY here, never from the success page.

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      console.error("Webhook signature failed:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const vendorId = session.metadata?.vendorId;

        if (session.payment_status !== "paid" || !ObjectId.isValid(vendorId)) {
          return res.json({ received: true });
        }

        // Skip if this payment was already processed (Stripe can retry).
        const existing = await transactions.findOne({
          stripeSessionId: session.id,
          status: "paid",
        });

        if (existing) {
          return res.json({ received: true });
        }

        await transactions.updateOne(
          { stripeSessionId: session.id },
          {
            $set: {
              status: "paid",
              amount: session.amount_total / 100,
              currency: session.currency,
              paidAt: new Date(),
            },
            $setOnInsert: {
              vendorId,
              plan: "premium",
              stripeSubscriptionId: null,
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );

        // If Premium is still active, add 30 days to the current end date.
        const vendor = await users.findOne({ _id: new ObjectId(vendorId) });
        const currentExpiry = vendor?.subscriptionExpiresAt
          ? new Date(vendor.subscriptionExpiresAt)
          : null;
        const startFrom =
          currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
        const expiresAt = new Date(
          startFrom.getTime() + PREMIUM_DAYS * 24 * 60 * 60 * 1000
        );

        await users.updateOne(
          { _id: new ObjectId(vendorId) },
          {
            $set: {
              subscriptionPlan: "premium",
              subscriptionExpiresAt: expiresAt,
            },
          }
        );
      }

      if (event.type === "checkout.session.expired") {
        await transactions.updateOne(
          { stripeSessionId: event.data.object.id, status: "pending" },
          { $set: { status: "expired" } }
        );
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Webhook handling failed:", error);
      res.status(500).json({ message: "Webhook handling failed." });
    }
  }
);

app.use(express.json());

// ==========================================
// JWT VERIFICATION MIDDLEWARE
// ==========================================
// Better Auth (Next.js client) signs the JWT.
// We download its public keys once and verify every token with them.

const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  try {
    // Rejects invalid or expired tokens
    const { payload } = await jwtVerify(token, JWKS);

    if (!ObjectId.isValid(payload.sub)) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    // Always load the user from the database, so a blocked user
    // or a changed role takes effect immediately.
    const user = await users.findOne({ _id: new ObjectId(payload.sub) });

    if (!user) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    if (user.isBlocked === true) {
      return res.status(403).json({ message: "Your account is blocked." });
    }

    req.user = { ...user, id: String(user._id) };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

// ==========================================
// ROLE MIDDLEWARES (use after verifyToken)
// ==========================================

// Customer bookings currently use Next.js API routes; this is ready
// for any customer-only Express route.
const verifyCustomer = (req, res, next) => {
  if (req.user.role !== "customer") {
    return res.status(403).json({ message: "Forbidden." });
  }
  next();
};

const verifyVendor = (req, res, next) => {
  if (req.user.role !== "vendor") {
    return res.status(403).json({ message: "Forbidden." });
  }
  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden." });
  }
  next();
};

// ==========================================
// HELPERS
// ==========================================

const isPremiumUser = (user) => {
  if (user?.subscriptionPlan !== "premium" || !user.subscriptionExpiresAt) {
    return false;
  }
  return new Date(user.subscriptionExpiresAt) > new Date();
};

// Free vendors can have at most 3 active services.
// "Active" = isActive is true and the service is not rejected.
// Pass the service id when checking an existing service,
// so it is not counted twice.
const canActivateMoreServices = async (vendor, serviceIdToSkip) => {
  if (isPremiumUser(vendor)) {
    return true;
  }

  const filter = {
    vendorId: String(vendor._id),
    isActive: true,
    status: { $ne: "rejected" },
  };

  if (serviceIdToSkip) {
    filter._id = { $ne: new ObjectId(serviceIdToSkip) };
  }

  const activeCount = await services.countDocuments(filter);
  return activeCount < FREE_PLAN_SERVICE_LIMIT;
};

const limitMessage = `Free plan allows ${FREE_PLAN_SERVICE_LIMIT} active services. Upgrade to Premium for unlimited services.`;

// Image links must be normal web addresses (blocks "javascript:" or "data:" links)
const webUrl = z.url({ protocol: /^https?$/ });

const serviceSchema = z.object({
  serviceName: z.string().trim().min(3).max(120),
  category: z.enum(SERVICE_CATEGORIES),
  description: z.string().trim().min(20).max(3000),
  price: z.number().positive().max(1000000),
  location: z.string().trim().min(2).max(120),
  images: z.array(webUrl).min(1).max(5),
});

// GET /services
// Public listing, search, filters, sorting, featured limit
app.get("/services", async (req, res) => {
  try {
    const {
      search = "",
      category = "",
      location = "",
      sort = "newest",
      limit,
    } = req.query;

    const filter = { ...publicServiceFilter };

    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Advanced search: match name, description, category,
    // location or vendor name
    if (typeof search === "string" && search.trim()) {
      const keyword = { $regex: escapeRegex(search.trim()), $options: "i" };

      filter.$or = [
        { serviceName: keyword },
        { description: keyword },
        { category: keyword },
        { location: keyword },
        { vendorName: keyword },
      ];
    }

    if (typeof category === "string" && category.trim()) {
      filter.category = category.trim();
    }

    if (typeof location === "string" && location.trim()) {
      filter.location = {
        $regex: escapeRegex(location.trim()),
        $options: "i",
      };
    }

    const sortOptions = {
      newest: { createdAt: -1, _id: -1 },
      price_asc: { price: 1, _id: -1 },
      price_desc: { price: -1, _id: -1 },
    };

    const sortBy =
      typeof sort === "string" && sortOptions[sort]
        ? sortOptions[sort]
        : sortOptions.newest;

    const parsedLimit = Number(limit);
    const safeLimit =
      limit !== undefined &&
      String(limit).trim() !== "" &&
      Number.isInteger(parsedLimit) &&
      parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 24;

    const results = await services
      .find(filter)
      .sort(sortBy)
      .limit(safeLimit)
      .toArray();

    res.status(200).json(results);
  } catch (error) {
    console.error("Failed to fetch services:", error);
    res.status(500).json({
      message: "Failed to fetch wedding services.",
    });
  }
});

// GET /services/:id
app.get("/services/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid service ID.",
      });
    }

    const service = await services.findOne({
      _id: new ObjectId(id),
      ...publicServiceFilter,
    });

    if (!service) {
      return res.status(404).json({
        message: "Service not found.",
      });
    }

    res.status(200).json(service);
  } catch (error) {
    console.error("Failed to fetch service:", error);
    res.status(500).json({
      message: "Failed to fetch service details.",
    });
  }
});

// ==========================================
// VENDOR: SERVICES
// ==========================================

// POST /vendor/services - create a new service (status: pending)
app.post("/vendor/services", verifyToken, verifyVendor, async (req, res) => {
  try {
    const parsed = serviceSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Please fill in all service fields correctly.",
      });
    }

    const allowed = await canActivateMoreServices(req.user);

    if (!allowed) {
      return res.status(403).json({ message: limitMessage });
    }

    const newService = {
      ...parsed.data,
      vendorId: req.user.id,
      vendorName: req.user.businessName || req.user.name,
      vendorEmail: req.user.email,
      status: "pending",
      isActive: true,
      createdAt: new Date(),
    };

    const result = await services.insertOne(newService);

    res.status(201).json({
      message: "Service submitted. It will be visible after admin approval.",
      serviceId: result.insertedId,
    });
  } catch (error) {
    console.error("Create service error:", error);
    res.status(500).json({ message: "Failed to create service." });
  }
});

// PATCH /vendor/services/:id - update own service
// After editing, the service goes back to "pending" for admin review.
app.patch(
  "/vendor/services/:id",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid service ID." });
      }

      const parsed = serviceSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: "Please fill in all service fields correctly.",
        });
      }

      // Ownership check: the service must belong to this vendor
      const service = await services.findOne({
        _id: new ObjectId(id),
        vendorId: req.user.id,
      });

      if (!service) {
        return res.status(404).json({ message: "Service not found." });
      }

      // A rejected service becomes pending again, so check the limit.
      if (service.isActive && service.status === "rejected") {
        const allowed = await canActivateMoreServices(req.user, id);
        if (!allowed) {
          return res.status(403).json({ message: limitMessage });
        }
      }

      await services.updateOne(
        { _id: new ObjectId(id), vendorId: req.user.id },
        {
          $set: {
            ...parsed.data,
            status: "pending",
            updatedAt: new Date(),
          },
        }
      );

      res.json({ message: "Service updated and sent for admin review." });
    } catch (error) {
      console.error("Update service error:", error);
      res.status(500).json({ message: "Failed to update service." });
    }
  }
);

// PATCH /vendor/services/:id/availability - turn a service on or off
app.patch(
  "/vendor/services/:id/availability",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (!ObjectId.isValid(id) || typeof isActive !== "boolean") {
        return res.status(400).json({ message: "Invalid request." });
      }

      const service = await services.findOne({
        _id: new ObjectId(id),
        vendorId: req.user.id,
      });

      if (!service) {
        return res.status(404).json({ message: "Service not found." });
      }

      if (isActive) {
        const allowed = await canActivateMoreServices(req.user, id);
        if (!allowed) {
          return res.status(403).json({ message: limitMessage });
        }
      }

      await services.updateOne(
        { _id: new ObjectId(id), vendorId: req.user.id },
        { $set: { isActive, updatedAt: new Date() } }
      );

      res.json({
        message: isActive ? "Service is now available." : "Service is now hidden.",
      });
    } catch (error) {
      console.error("Service availability error:", error);
      res.status(500).json({ message: "Failed to update availability." });
    }
  }
);

// DELETE /vendor/services/:id - delete own service
app.delete(
  "/vendor/services/:id",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid service ID." });
      }

      const result = await services.deleteOne({
        _id: new ObjectId(id),
        vendorId: req.user.id,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "Service not found." });
      }

      res.json({ message: "Service deleted." });
    } catch (error) {
      console.error("Delete service error:", error);
      res.status(500).json({ message: "Failed to delete service." });
    }
  }
);

// ==========================================
// ADMIN: USERS
// ==========================================

// PATCH /admin/users/:id/block - block or unblock a user
app.patch(
  "/admin/users/:id/block",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isBlocked } = req.body;

      if (!ObjectId.isValid(id) || typeof isBlocked !== "boolean") {
        return res.status(400).json({ message: "Invalid request." });
      }

      const target = await users.findOne({ _id: new ObjectId(id) });

      if (!target) {
        return res.status(404).json({ message: "User not found." });
      }

      if (target.role === "admin") {
        return res.status(403).json({ message: "Admin accounts cannot be blocked." });
      }

      await users.updateOne({ _id: new ObjectId(id) }, { $set: { isBlocked } });

      res.json({ message: isBlocked ? "User blocked." : "User unblocked." });
    } catch (error) {
      console.error("Block user error:", error);
      res.status(500).json({ message: "Failed to update user." });
    }
  }
);

// ==========================================
// ADMIN: SERVICES
// ==========================================

// PATCH /admin/services/:id/status - approve, reject, or set back to pending
app.patch(
  "/admin/services/:id/status",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (
        !ObjectId.isValid(id) ||
        !["pending", "approved", "rejected"].includes(status)
      ) {
        return res.status(400).json({ message: "Invalid request." });
      }

      const service = await services.findOne({ _id: new ObjectId(id) });

      if (!service) {
        return res.status(404).json({ message: "Service not found." });
      }

      // A rejected service coming back must respect the vendor's plan limit.
      if (service.status === "rejected" && status !== "rejected" && service.isActive) {
        const vendor = ObjectId.isValid(service.vendorId)
          ? await users.findOne({ _id: new ObjectId(service.vendorId) })
          : null;

        if (!vendor) {
          return res.status(409).json({ message: "Vendor account not found." });
        }

        const allowed = await canActivateMoreServices(vendor, id);
        if (!allowed) {
          return res.status(403).json({
            message: "This vendor already has 3 active services on the Free plan.",
          });
        }
      }

      await services.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, updatedAt: new Date() } }
      );

      res.json({ message: `Service marked as ${status}.` });
    } catch (error) {
      console.error("Service status error:", error);
      res.status(500).json({ message: "Failed to update service status." });
    }
  }
);

// DELETE /admin/services/:id - remove an inappropriate service
app.delete(
  "/admin/services/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid service ID." });
      }

      const result = await services.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "Service not found." });
      }

      res.json({ message: "Service deleted." });
    } catch (error) {
      console.error("Admin delete service error:", error);
      res.status(500).json({ message: "Failed to delete service." });
    }
  }
);

// Note: there is intentionally NO route to edit transactions.
// Payment records are only written by the Stripe webhook.

// ==========================================
// PAYMENTS
// ==========================================

// POST /payments/create-checkout-session - vendor upgrades to Premium
app.post(
  "/payments/create-checkout-session",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    try {
      // The vendor id always comes from the verified token, never the body.
      const vendorId = req.user.id;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: req.user.email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: PREMIUM_PRICE_CENTS,
              product_data: {
                name: `WedPlan Premium (${PREMIUM_DAYS} days)`,
                description: "Unlimited active services and Premium Vendor badge",
              },
            },
            quantity: 1,
          },
        ],
        metadata: { vendorId },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel`,
      });

      await transactions.insertOne({
        vendorId,
        vendorName: req.user.businessName || req.user.name,
        vendorEmail: req.user.email,
        plan: "premium",
        amount: PREMIUM_PRICE_CENTS / 100,
        currency: "usd",
        stripeSessionId: session.id,
        stripeSubscriptionId: null,
        status: "pending",
        createdAt: new Date(),
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Create checkout session error:", error);
      res.status(500).json({ message: "Failed to start payment." });
    }
  }
);

app.get("/", (req, res) => {
  res.send("WedPlan server is running!");
});

app.listen(port, () => {
  console.log(`WedPlan server running on port ${port}`);
});
