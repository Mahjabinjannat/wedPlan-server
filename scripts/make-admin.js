// Promote an existing account to admin.
// Admins must NOT be created through public sign up.
//
// Usage (register the account normally first):
//   node scripts/make-admin.js admin@wedplan.com

import "dotenv/config";
import { MongoClient } from "mongodb";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.log("Usage: node scripts/make-admin.js <email>");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();

  const result = await client
    .db(process.env.DB_NAME || "wedplanDB")
    .collection("user")
    .updateOne({ email }, { $set: { role: "admin", isBlocked: false } });

  console.log(
    result.matchedCount
      ? `${email} is now an admin.`
      : `No user found with email ${email}.`
  );
} catch (error) {
  console.error("Failed to make admin:", error);
} finally {
  await client.close();
}
