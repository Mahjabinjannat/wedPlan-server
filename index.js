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

app.get("/", (req, res) => {
  res.send("WedPlan server is running!");
});

app.listen(port, () => {
  console.log(`WedPlan server running on port ${port}`);
});
