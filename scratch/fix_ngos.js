// Server/scratch/fix_ngos.js
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;

const MONGODB_URI = process.env.MONGODB_URI || `mongodb+srv://${DB_USER}:${DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;
const DB_NAME = process.env.DB_NAME || 'communityDB';

async function run() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    console.log('Connected to MongoDB.');
    const db = client.db(DB_NAME);
    const ngoCol = db.collection('ngos');

    const ngos = await ngoCol.find({}).toArray();
    console.log(`Found ${ngos.length} NGOs in database. Processing updates...`);

    let updatedCount = 0;

    for (const ngo of ngos) {
      const updates = {};

      // 1. Align email -> contactEmail
      if (!ngo.contactEmail && ngo.email) {
        updates.contactEmail = ngo.email;
      }

      // 2. Align description -> mission
      if (!ngo.mission && ngo.description) {
        updates.mission = ngo.description;
      }

      // 3. Align logo -> logoUrl
      if (!ngo.logoUrl) {
        updates.logoUrl = ngo.logo || "https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&q=80&w=200";
      }

      // 4. Align serviceTypes -> focusAreas
      if (!ngo.focusAreas || ngo.focusAreas.length === 0) {
        const focus = new Set();
        const types = ngo.serviceTypes || [];
        
        types.forEach(t => {
          const typeLower = t.toLowerCase();
          if (typeLower.includes('animal') || typeLower.includes('vet')) {
            focus.add('animals');
          } else if (typeLower.includes('environment') || typeLower.includes('greening') || typeLower.includes('clean')) {
            focus.add('environment');
          } else if (typeLower.includes('cleanup') || typeLower.includes('volunteer') || typeLower.includes('welfare') || typeLower.includes('community')) {
            focus.add('community');
          } else if (typeLower.includes('education') || typeLower.includes('school')) {
            focus.add('education');
          } else if (typeLower.includes('health') || typeLower.includes('medical')) {
            focus.add('health');
          }
        });

        // Fallbacks based on name
        if (focus.size === 0) {
          const nameLower = ngo.name.toLowerCase();
          if (nameLower.includes('animal') || nameLower.includes('paw')) {
            focus.add('animals');
          } else if (nameLower.includes('clean') || nameLower.includes('green') || nameLower.includes('roots')) {
            focus.add('environment');
          } else {
            focus.add('community');
          }
        }

        updates.focusAreas = Array.from(focus);
      }

      if (Object.keys(updates).length > 0) {
        await ngoCol.updateOne({ _id: ngo._id }, { $set: updates });
        console.log(`Updated NGO "${ngo.name}":`, updates);
        updatedCount++;
      }
    }

    console.log(`Successfully migrated ${updatedCount} NGO records.`);
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.close();
  }
}

run();
