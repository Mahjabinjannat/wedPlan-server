import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const port = process.env.PORT || 8000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

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

const publicServiceFilter = {
  status: "approved",
  isActive: true,
};

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

    // Search by service name
    if (typeof search === "string" && search.trim()) {
      filter.serviceName = {
        $regex: escapeRegex(search.trim()),
        $options: "i",
      };
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

app.get("/", (req, res) => {
  res.send("WedPlan server is running!");
});

app.listen(port, () => {
  console.log(`WedPlan server running on port ${port}`);
});
