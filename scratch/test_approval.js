const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("communityDB");
    const usersCollection = db.collection("users");
    const membershipCollection = db.collection("membershipRequests");

    // Reset user to guest and clear copied address fields
    console.log("Resetting user to guest...");
    await usersCollection.updateOne(
      { email: "orghodutta@gmail.com" },
      {
        $set: { role: "guest", area: "" },
        $unset: { memberId: "", verifiedAt: "", phone: "", streetAddress: "", apartmentNumber: "" }
      }
    );

    // Reset request to pending
    console.log("Resetting membership request to pending...");
    await membershipCollection.updateOne(
      { email: "orghodutta@gmail.com" },
      { $set: { status: "pending" } }
    );

    // Verify reset state
    let u = await usersCollection.findOne({ email: "orghodutta@gmail.com" });
    console.log("Reset user state:", {
      role: u.role,
      area: u.area,
      phone: u.phone,
      streetAddress: u.streetAddress,
      apartmentNumber: u.apartmentNumber
    });

    // Run the approval code
    console.log("Simulating approval...");
    const reqDoc = await membershipCollection.findOne({ email: "orghodutta@gmail.com", status: "pending" });
    if (!reqDoc) {
      throw new Error("Pending membership request not found!");
    }

    const id = reqDoc._id.toString();
    const status = "approved";
    const email = "orghodutta@gmail.com";

    // 1. Update status
    await membershipCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: status, reviewedAt: new Date() } }
    );

    // 2. Sync to user
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const memberId = `MEM-${randomNum}`;

    const membershipRequest = await membershipCollection.findOne({ _id: new ObjectId(id) });
    const addressDetails = membershipRequest ? {
      name: membershipRequest.name,
      phone: membershipRequest.phone,
      area: membershipRequest.area,
      streetAddress: membershipRequest.streetAddress,
      apartmentNumber: membershipRequest.apartmentNumber
    } : {};

    console.log("Copying details:", addressDetails);

    await usersCollection.updateOne(
      { email: email },
      { 
        $set: { 
          role: "member", 
          memberId, 
          verifiedAt: new Date(),
          ...addressDetails
        } 
      }
    );

    // Verify after approval state
    u = await usersCollection.findOne({ email: "orghodutta@gmail.com" });
    console.log("After approval user state:", {
      role: u.role,
      area: u.area,
      phone: u.phone,
      streetAddress: u.streetAddress,
      apartmentNumber: u.apartmentNumber
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
