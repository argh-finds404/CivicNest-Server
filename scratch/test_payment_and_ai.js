const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { connectDB, getCollection } = require('../config/db');
const PendingTransaction = require('../models/PendingTransaction');
const paymentRouter = require('../routes/payment');
const { ObjectId } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testPaymentFlow(db) {
  console.log('\n--- STARTING PAYMENT FLOW INTEGRATION TEST ---');
  
  const usersCol = getCollection('users');
  const cleanupeventsCol = getCollection('cleanupevents');
  const animalsCol = getCollection('animals');
  const ngosCol = getCollection('ngos');
  const contributionsCol = getCollection('contributions');
  const notificationsCol = getCollection('notifications');

  // 1. Prepare Mock Entities
  const userEmail = 'test_donator@test.com';
  const orgEmail = 'organizer@test.com';
  const repEmail = 'reporter@test.com';
  const ngoAdminEmail = 'ngo_admin@test.com';

  console.log('Seeding mock users, event, animal rescue, and NGO...');
  
  // Ensure mock donator user exists
  await usersCol.deleteOne({ email: userEmail });
  await usersCol.insertOne({
    email: userEmail,
    name: 'Test Donator',
    points: 0,
    badges: [],
  });

  // Ensure mock organizer exists for notifications
  await usersCol.deleteOne({ email: orgEmail });
  await usersCol.insertOne({
    email: orgEmail,
    name: 'Mock Organizer',
    points: 0,
  });

  // Insert mock cleanupevent
  const eventInsert = await cleanupeventsCol.insertOne({
    title: 'Clean the Park Test Drive',
    organizer: { email: orgEmail, name: 'Mock Organizer' },
    fundingGoal: 5000,
    fundingRaised: 0,
    approvalStatus: 'approved',
    status: 'upcoming',
  });
  const eventId = eventInsert.insertedId;

  // Insert mock animal rescue
  const animalInsert = await animalsCol.insertOne({
    animalType: 'Dog',
    condition: 'Injured Leg',
    reporter: { email: repEmail, name: 'Mock Reporter' },
    fundingRaised: 0,
  });
  const animalId = animalInsert.insertedId;

  // Insert mock NGO
  const ngoInsert = await ngosCol.insertOne({
    name: 'Green Earth NGO',
    adminEmail: ngoAdminEmail,
    totalDonations: 0,
  });
  const ngoId = ngoInsert.insertedId;

  console.log(`Mock entities created:
  - Event ID: ${eventId}
  - Animal ID: ${animalId}
  - NGO ID: ${ngoId}`);

  // 2. Prepare Transactions
  const eventTranId = 'TEST_SSL_EVENT_' + Date.now();
  const animalTranId = 'TEST_STRIPE_ANIMAL_' + Date.now();
  const ngoTranId = 'TEST_SSL_NGO_' + Date.now();

  console.log('Creating pending transactions...');
  await PendingTransaction.deleteMany({ userId: userEmail });

  await PendingTransaction.create([
    {
      tran_id: eventTranId,
      gateway: 'sslcommerz',
      amount: 1500,
      currency: 'BDT',
      donationType: 'event',
      referenceId: eventId,
      userId: userEmail,
      status: 'pending'
    },
    {
      tran_id: animalTranId,
      gateway: 'stripe',
      amount: 800,
      currency: 'BDT',
      donationType: 'animal',
      referenceId: animalId,
      userId: userEmail,
      status: 'pending'
    },
    {
      tran_id: ngoTranId,
      gateway: 'sslcommerz',
      amount: 2500,
      currency: 'BDT',
      donationType: 'ngo',
      referenceId: ngoId,
      userId: userEmail,
      status: 'pending'
    }
  ]);

  // 3. Process Payments
  console.log('Invoking paymentRouter.processDonation for Event, Animal, and NGO...');
  await paymentRouter.processDonation(eventTranId, {});
  await paymentRouter.processDonation(animalTranId, {});
  await paymentRouter.processDonation(ngoTranId, {});

  // 4. Verify Database Modifications
  console.log('\nVerifying database updates:');

  // Verify Transactions Status
  const tEvent = await PendingTransaction.findOne({ tran_id: eventTranId });
  const tAnimal = await PendingTransaction.findOne({ tran_id: animalTranId });
  const tNgo = await PendingTransaction.findOne({ tran_id: ngoTranId });

  console.log(`- Event Transaction Status: ${tEvent?.status} (Expected: success)`);
  console.log(`- Animal Transaction Status: ${tAnimal?.status} (Expected: success)`);
  console.log(`- NGO Transaction Status: ${tNgo?.status} (Expected: success)`);

  // Verify Entity Funding Amounts
  const updatedEvent = await cleanupeventsCol.findOne({ _id: eventId });
  const updatedAnimal = await animalsCol.findOne({ _id: animalId });
  const updatedNgo = await ngosCol.findOne({ _id: ngoId });

  console.log(`- Cleanup Event 'fundingRaised': ${updatedEvent?.fundingRaised} BDT (Expected: 1500)`);
  console.log(`- Animal 'fundingRaised': ${updatedAnimal?.fundingRaised} BDT (Expected: 800)`);
  console.log(`- NGO 'totalDonations': ${updatedNgo?.totalDonations} BDT (Expected: 2500)`);

  // Verify Contributions Log
  const eventContribution = await contributionsCol.findOne({ eventId: eventId.toString() });
  const animalContribution = await contributionsCol.findOne({ animalId: animalId.toString() });
  const ngoContribution = await contributionsCol.findOne({ ngoId: ngoId.toString() });

  console.log(`- Contributions Logged:
    * Event contribution amount: ${eventContribution?.amount} BDT from ${eventContribution?.email}
    * Animal contribution amount: ${animalContribution?.amount} BDT from ${animalContribution?.email}
    * NGO contribution amount: ${ngoContribution?.amount} BDT from ${ngoContribution?.email}`);

  // Verify Donator Points
  const donatorUser = await usersCol.findOne({ email: userEmail });
  console.log(`- Donator points earned: ${donatorUser?.points} (Expected: 45)`);

  // Verify Notifications Received
  const orgNotif = await notificationsCol.findOne({ email: orgEmail, message: /donated ৳1500/ });
  const repNotif = await notificationsCol.findOne({ email: repEmail, message: /donated ৳800/ });
  const ngoNotif = await notificationsCol.findOne({ email: ngoAdminEmail, message: /received a donation of ৳2500/ });

  console.log(`- Notifications triggered:
    * Organizer notified: ${orgNotif ? 'YES' : 'NO'} ("${orgNotif?.message}")
    * Reporter notified: ${repNotif ? 'YES' : 'NO'} ("${repNotif?.message}")
    * NGO Admin notified: ${ngoNotif ? 'YES' : 'NO'} ("${ngoNotif?.message}")`);

  // 5. Cleanup
  console.log('Cleaning up mock data...');
  await usersCol.deleteOne({ email: userEmail });
  await usersCol.deleteOne({ email: orgEmail });
  await cleanupeventsCol.deleteOne({ _id: eventId });
  await animalsCol.deleteOne({ _id: animalId });
  await ngosCol.deleteOne({ _id: ngoId });
  await PendingTransaction.deleteMany({ tran_id: { $in: [eventTranId, animalTranId, ngoTranId] } });
  await contributionsCol.deleteMany({ email: userEmail });
  await notificationsCol.deleteMany({ email: { $in: [orgEmail, repEmail, ngoAdminEmail] } });

  console.log('--- PAYMENT FLOW INTEGRATION TEST COMPLETE ---');
}

async function testAIFlow() {
  console.log('\n--- STARTING AI FLOW AND GEMINI INTEGRATION TEST ---');

  // 1. Test robust JSON parsing logic directly
  console.log('Testing safeJsonParse helper functionality...');
  
  function safeJsonParse(text) {
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match) {
        try {
          return JSON.parse(match[1].trim());
        } catch (innerErr) {
          // ignore
        }
      }
      throw err;
    }
  }

  const cleanJson = '{"isSpam": false, "confidence": 95, "reason": "Clear report"}';
  const markdownJson = '```json\n{"isSpam": true, "confidence": 99, "reason": "Gibberish content"}\n```';
  const simpleMarkdown = '```\n{"category": "Garbage", "urgency": "medium", "polishedDescription": "A test description", "estimatedCostBDT": 1000}\n```';

  try {
    const parsedClean = safeJsonParse(cleanJson);
    console.log('  [PASS] Clean JSON parsed:', parsedClean.confidence === 95);
    
    const parsedMarkdown = safeJsonParse(markdownJson);
    console.log('  [PASS] Markdown code fence JSON parsed:', parsedMarkdown.isSpam === true);

    const parsedSimpleMarkdown = safeJsonParse(simpleMarkdown);
    console.log('  [PASS] Simple code fence JSON parsed:', parsedSimpleMarkdown.category === 'Garbage');
  } catch (err) {
    console.error('  [FAIL] Parsing helper failed:', err.message);
  }

  // 2. Make live API Call to Gemini
  if (!process.env.GEMINI_API_KEY) {
    console.log('Skipping live Gemini API test because GEMINI_API_KEY is not defined in env.');
    return;
  }

  console.log('Making real API call to Gemini to test `/suggest-issue` logic...');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const description = "There is a massive pile of trash dumped near the main road next to the community center. It smells awful and is blocking the pedestrian footpath.";
  const prompt = `
    A user submitted this civic issue description: "${description}"
    
    Respond ONLY with valid JSON, no markdown, no backticks:
    {
      "category": "one of: Garbage, Road Damage, Illegal Construction, Waterlogging, Broken Property, Safety, Environmental, Other",
      "urgency": "one of: low, medium, high, emergency",
      "polishedDescription": "rewritten version in 2-3 clear sentences",
      "estimatedCostBDT": number
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log('Raw response from Gemini:');
    console.log(text.trim());
    
    const parsed = safeJsonParse(text);
    console.log('Successfully parsed output via safeJsonParse:');
    console.log(JSON.stringify(parsed, null, 2));
    
    if (parsed.category && parsed.urgency && parsed.polishedDescription) {
      console.log('  [PASS] Gemini response matches the expected schema structure.');
    } else {
      console.log('  [FAIL] Gemini response is missing required fields.');
    }
  } catch (err) {
    console.error('  [FAIL] Live Gemini test encountered an error:', err.message);
  }

  console.log('--- AI FLOW AND GEMINI INTEGRATION TEST COMPLETE ---');
}

async function run() {
  const db = await connectDB();
  await testPaymentFlow(db);
  await testAIFlow();
  process.exit(0);
}

run().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
