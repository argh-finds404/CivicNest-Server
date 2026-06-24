// Server/seedData.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;
const DB_NAME     = process.env.DB_NAME || 'communityDB';

const AREAS = ['Mirpur', 'Dhanmondi', 'Gulshan', 'Uttara', 'Mohammadpur', 'Banani', 'Badda', 'Khilgaon'];

// ── Animals ────────────────────────────────────────────────────────────────────
const ANIMALS = [
  { animalType: 'Dog',  condition: 'Injured dog found near Road 7 with a wound on its left hind leg. Unable to walk properly.',    urgency: 'high',      status: 'needs-help',   area: 'Mirpur',       location: 'Road 7, Mirpur 10' },
  { animalType: 'Cat',  condition: 'Kitten stuck on a balcony ledge, third floor. Has been there for over 6 hours.',               urgency: 'emergency', status: 'needs-help',   area: 'Dhanmondi',    location: 'Road 27, Dhanmondi' },
  { animalType: 'Dog',  condition: 'Stray dog with mange skin condition. Very thin, appears malnourished.',                        urgency: 'medium',    status: 'in-treatment', area: 'Gulshan',      location: 'Gulshan 2 circle area' },
  { animalType: 'Cow',  condition: 'Injured cow blocking the road, possible broken front leg. Causing traffic and in obvious pain.',urgency: 'emergency', status: 'needs-help',   area: 'Mohammadpur',  location: 'Mohammadpur bus stand' },
  { animalType: 'Bird', condition: 'Baby bird fallen from nest. Parents nowhere to be seen. Wing appears bruised.',                urgency: 'medium',    status: 'needs-help',   area: 'Banani',       location: 'Banani Park, Road 11' },
  { animalType: 'Cat',  condition: 'Pregnant cat in distress near market, clearly about to give birth. Needs safe shelter.',       urgency: 'high',      status: 'needs-help',   area: 'Badda',        location: 'Badda bazaar area' },
  { animalType: 'Dog',  condition: 'Medium-sized mixed breed found wandering with collar but no tag. Well-fed, might be lost.',    urgency: 'low',       status: 'rescued',      area: 'Uttara',       location: 'Uttara Sector 3' },
  { animalType: 'Cat',  condition: 'Ginger cat with eye infection found near school. Has been there 3 days.',                      urgency: 'medium',    status: 'in-treatment', area: 'Khilgaon',     location: 'Khilgaon Chowrastha' },
];

// ── Lost & Found ───────────────────────────────────────────────────────────────
const LOST_FOUND = [
  { type: 'lost',  itemName: 'Samsung Galaxy S23 Ultra',    category: 'Electronics', description: 'Black colour, cracked screen protector on bottom-right. Lock screen shows a photo of a cat. Last seen near Bashundhara City.', area: 'Dhanmondi',   location: 'Bashundhara City Mall, Panthapath', reward: 500,  status: 'open' },
  { type: 'found', itemName: 'National ID Card',            category: 'Documents',   description: 'Found a National ID card near the bus stop. Name on the card is Mohammad Rafiqul Islam. Will hand it to the owner directly.', area: 'Mirpur',      location: 'Mirpur 1 bus stop', reward: 0, status: 'open' },
  { type: 'lost',  itemName: 'Golden Retriever — Buddy',    category: 'Pet',         description: '3-year-old male Golden Retriever. Wearing a red collar with a bone-shaped tag. Missing since Tuesday morning. Very friendly.', area: 'Gulshan',     location: 'Gulshan Lake Park area', reward: 2000, status: 'open' },
  { type: 'found', itemName: 'Brown leather wallet',        category: 'Wallet/Keys', description: 'Found near Farmgate. Contains some cash and a few cards. No ID visible. Handing over to nearest police station if not claimed.', area: 'Dhanmondi',  location: 'Farmgate, Tejgaon', reward: 0, status: 'open' },
  { type: 'lost',  itemName: 'MacBook Air M2 — Silver',     category: 'Electronics', description: 'Left in a CNG rickshaw near Banani DOHS. Has a blue sticker on the back. Password protected. Will verify with serial number.', area: 'Banani',      location: 'Banani DOHS Gate 2', reward: 1000, status: 'open' },
  { type: 'found', itemName: 'Bunch of house keys',         category: 'Wallet/Keys', description: 'Set of 4 keys on a red keyring with a miniature Eiffel Tower charm. Found at Gulshan 1 roundabout.', area: 'Gulshan',     location: 'Gulshan 1 roundabout', reward: 0, status: 'open' },
  { type: 'lost',  itemName: 'Black school backpack',       category: 'Clothing',    description: 'Black Nike backpack with a torn left strap. Contains school books, a blue pencil case, and a lunch box. Lost near school gate.', area: 'Mohammadpur', location: 'Mohammadpur Govt School', reward: 0, status: 'reunited' },
  { type: 'found', itemName: 'Prescription Glasses',        category: 'Other',       description: 'Black-framed prescription glasses in a hard case. Found at a tea stall near Uttara Sector 7.', area: 'Uttara',      location: 'Uttara Sector 7 tea stall', reward: 0, status: 'open' },
];

// ── NGOs ───────────────────────────────────────────────────────────────────────
const NGOS = [
  {
    name: 'Dhaka Animal Welfare Society',
    contactEmail: 'contact@daws.org.bd',
    phone: '01711-234567',
    registrationNumber: 'NGO-BD-2018-0043',
    mission: 'A registered non-profit dedicated to rescuing and rehabilitating stray animals across Dhaka city. We operate 2 shelters and a mobile vet unit.',
    logoUrl: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&q=80&w=200',
    focusAreas: ['animals'],
    status: 'verified',
    website: 'https://daws.org.bd',
  },
  {
    name: 'Clean Dhaka Initiative',
    contactEmail: 'info@cleandhaka.org',
    phone: '01755-345678',
    registrationNumber: 'NGO-BD-2020-0112',
    mission: 'Community-driven organisation focused on weekly neighbourhood cleanups, waste segregation awareness, and community recycling programs in Dhaka.',
    logoUrl: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&q=80&w=200',
    focusAreas: ['environment'],
    status: 'verified',
    website: 'https://cleandhaka.org',
  },
  {
    name: 'Green Roots Foundation',
    contactEmail: 'hello@greenroots.bd',
    phone: '01833-456789',
    registrationNumber: 'NGO-BD-2021-0198',
    mission: 'We plant trees and establish community gardens in urban neighborhoods to combat heat islands and improve air quality across Dhaka.',
    logoUrl: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&q=80&w=200',
    focusAreas: ['environment'],
    status: 'verified',
  },
  {
    name: 'Paw Rescue Bangladesh',
    contactEmail: 'rescue@pawbd.org',
    phone: '01944-567890',
    registrationNumber: 'NGO-BD-2022-0267',
    mission: 'Emergency rescue service for injured and sick stray animals. We operate a 24-hour emergency hotline and work with volunteer networks across Dhaka.',
    logoUrl: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&q=80&w=200',
    focusAreas: ['animals'],
    status: 'pending',
  },
  {
    name: 'Community Helpers Network',
    contactEmail: 'network@chnetwork.org.bd',
    phone: '01622-678901',
    registrationNumber: 'NGO-BD-2023-0315',
    mission: 'Connecting community volunteers with civic problems that need boots on the ground. We mobilise volunteers for issue resolution and cleanup drives.',
    logoUrl: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&q=80&w=200',
    focusAreas: ['community', 'environment'],
    status: 'verified',
  },
];

// ── Forum Threads ──────────────────────────────────────────────────────────────
const FORUM_THREADS = [
  {
    title: 'What should we do about the garbage pile near Mirpur 10 overpass?',
    body: 'This pile has been there for 3 weeks now. I have reported it twice but nothing has happened. Anyone else from this area facing this? Should we do a mass report or organise a community cleanup?',
    category: 'Safety',
    postedBy: 'resident@mirpur.com',
    posterName: 'Resident Mirpur 10',
    upvotes: ['user1@mail.com', 'user2@mail.com', 'user3@mail.com'],
    isPinned: true,
    replies: [
      { body: 'I reported it last week too. The issue got approved but no action yet. Maybe if 10 people report the same spot it gets priority?', postedBy: 'citizen@mail.com', posterName: 'Ahmed K.', upvotes: [], date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      { body: 'I can help organise a Sunday cleanup. Who is in? We need maybe 8 people and some bags.', postedBy: 'volunteer@mail.com', posterName: 'Rashida B.', upvotes: ['user1@mail.com'], date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    ],
  },
  {
    title: 'Street dog population in Dhanmondi is growing — what is the right response?',
    body: 'I love dogs but there are now 12 strays around Road 27 and some are getting aggressive near the school. I think we need a TNR (Trap-Neuter-Return) program. Is anyone connected to any NGO that does this?',
    category: 'General',
    postedBy: 'dogfriend@mail.com',
    posterName: 'Tahmina S.',
    upvotes: ['u1@m.com', 'u2@m.com'],
    isPinned: false,
    replies: [
      { body: 'Dhaka Animal Welfare Society does TNR. I have used them before. Email contact@daws.org.bd', postedBy: 'helper@mail.com', posterName: 'Farhan H.', upvotes: [], date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ],
  },
  {
    title: 'Suggestion: Can we add a "resolved percentage" to the area health page?',
    body: 'It would be really motivating to see something like "Ward 12 has resolved 72% of reported issues this month". Right now the health score is good but I cannot tell what is actually improving.',
    category: 'Suggestions',
    postedBy: 'datadriven@mail.com',
    posterName: 'Imran R.',
    upvotes: ['a@m.com', 'b@m.com', 'c@m.com', 'd@m.com'],
    isPinned: false,
    replies: [],
  },
  {
    title: 'URGENT: Overflowing drain near Kallyanpur causing flooding every rain',
    body: 'Every time it rains more than 20 minutes, the drain on Kallyanpur main road overflows and floods 50 metres of road. Cars get stuck, pedestrians cannot cross. This has been happening for 2 years. Is anyone else facing this?',
    category: 'Safety',
    postedBy: 'flood@mail.com',
    posterName: 'Karim U.',
    upvotes: ['x@m.com', 'y@m.com', 'z@m.com', 'w@m.com', 'v@m.com'],
    isPinned: false,
    replies: [
      { body: 'Same in our area. I submitted an issue report with coordinates. If everyone upvotes it maybe it gets assigned.', postedBy: 'rain@mail.com', posterName: 'Nadia F.', upvotes: [], date: new Date() },
    ],
  },
  {
    title: 'Monthly meetup idea — should we do a CivicNest community walk?',
    body: 'What if once a month, community members from each ward do a 30-minute walk together identifying issues? We report them live on the app. Makes it social and productive at the same time.',
    category: 'Events',
    postedBy: 'walker@mail.com',
    posterName: 'Sadia M.',
    upvotes: ['p@m.com', 'q@m.com'],
    isPinned: false,
    replies: [],
  },
];


// ── Main seeder ────────────────────────────────────────────────────────────────
async function seed() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log('Connected to MongoDB:', DB_NAME);

  const DEMO_EMAIL = 'seed@civicnest.demo';
  const now = new Date();

  // ── Animals ─────────────────────────────────────────────────────────────────
  const animalCol = db.collection('animals');
  const existingAnimals = await animalCol.countDocuments({});
  if (existingAnimals > 5) {
    console.log('Animals: skipping (already has data)');
  } else {
    const docs = ANIMALS.map((a, i) => ({
      ...a,
      image:          null,
      coordinates:    { lat: 23.7 + (i * 0.01), lng: 90.4 + (i * 0.01) },
      reportedBy:     DEMO_EMAIL,
      volunteers:     [],
      volunteerCount: 0,
      approvalStatus: 'approved',
      date:           new Date(now - i * 2 * 24 * 60 * 60 * 1000),
    }));
    await animalCol.insertMany(docs);
    console.log(`Animals: seeded ${docs.length} documents`);
  }

  // ── Lost & Found ─────────────────────────────────────────────────────────────
  const lfCol = db.collection('lostFound');
  const existingLF = await lfCol.countDocuments({});
  if (existingLF > 5) {
    console.log('LostFound: skipping (already has data)');
  } else {
    const docs = LOST_FOUND.map((item, i) => ({
      ...item,
      image:          null,
      postedBy:       DEMO_EMAIL,
      contactEmail:   DEMO_EMAIL,
      coordinates:    { lat: 23.7 + (i * 0.008), lng: 90.39 + (i * 0.008) },
      approvalStatus: 'approved',
      claimedBy:      null,
      claimStatement: null,
      expiresAt:      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      date:           new Date(now - i * 1.5 * 24 * 60 * 60 * 1000),
    }));
    await lfCol.insertMany(docs);
    console.log(`LostFound: seeded ${docs.length} documents`);
  }

  // ── NGOs ─────────────────────────────────────────────────────────────────────
  const ngoCol = db.collection('ngos');
  const existingNGOs = await ngoCol.countDocuments({});
  if (existingNGOs > 3) {
    console.log('NGOs: skipping (already has data)');
  } else {
    const docs = NGOS.map(ngo => ({
      ...ngo,
      logo:           null,
      proofDocument:  null,
      verifiedAt:     ngo.status === 'verified' ? new Date(now - 30 * 24 * 60 * 60 * 1000) : null,
      registeredAt:   new Date(now - 60 * 24 * 60 * 60 * 1000),
    }));
    await ngoCol.insertMany(docs);
    console.log(`NGOs: seeded ${docs.length} documents`);
  }

  // ── Forum ────────────────────────────────────────────────────────────────────
  const forumCol = db.collection('forum');
  const existingForum = await forumCol.countDocuments({});
  if (existingForum > 5) {
    console.log('Forum: skipping (already has data)');
  } else {
    const docs = FORUM_THREADS.map((thread, i) => ({
      ...thread,
      replies:        thread.replies.map(r => ({ ...r, _id: new (require('mongodb').ObjectId)() })),
      replyCount:     thread.replies.length,
      approvalStatus: 'approved',
      isLocked:       false,
      date:           new Date(now - i * 3 * 24 * 60 * 60 * 1000),
    }));
    await forumCol.insertMany(docs);
    console.log(`Forum: seeded ${docs.length} documents`);
  }

  await client.close();
  console.log('\nSeeding complete.');
}

seed().catch(console.error);
