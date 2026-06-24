const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { connectDB, getCollection } = require('../config/db');

async function seed() {
  const db = await connectDB();
  const contributionsCol = getCollection('contributions') || db.collection('contributions');

  const email = 'orghodutta@gmail.com';
  
  // Clear any existing test contributions for this user first so we have a clean state
  await contributionsCol.deleteMany({ email: email });

  const mockDonations = [
    {
      amount: 1200,
      email: email,
      date: new Date('2026-06-15T10:00:00Z'),
      type: 'event',
      title: 'Gulshan Lake Cleanup Drive',
      escrowStatus: 'released'
    },
    {
      amount: 2500,
      email: email,
      date: new Date('2026-06-18T14:30:00Z'),
      type: 'animal',
      title: 'Vaccines for Stray Dogs',
      escrowStatus: 'released'
    },
    {
      amount: 3000,
      email: email,
      date: new Date('2026-06-22T09:15:00Z'),
      type: 'event',
      title: 'Drainage Refitting in Sector 4',
      escrowStatus: 'holding'
    }
  ];

  const result = await contributionsCol.insertMany(mockDonations);
  console.log(`Seeded ${result.insertedCount} donations for ${email} successfully!`);
  
  process.exit(0);
}

seed().catch(err => {
  console.error('Failed to seed donations:', err);
  process.exit(1);
});
