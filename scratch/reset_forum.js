// Server/scratch/reset_forum.js
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dglhl0x.mongodb.net/?appName=Cluster0`;
const DB_NAME = 'communityDB';

const FORUM_THREADS = [
  {
    title: 'What should we do about the garbage pile near Mirpur 10 overpass?',
    body: 'This pile has been there for 3 weeks now. I have reported it twice but nothing has happened. Anyone else from this area facing this? Should we do a mass report or organise a community cleanup?',
    category: 'Safety',
    postedBy: 'resident@mirpur.com',
    posterName: 'Resident Mirpur 10',
    upvotes: ['user1@mail.com', 'user2@mail.com', 'user3@mail.com'],
    upvoteCount: 3,
    isPinned: true,
    replies: [
      { _id: new ObjectId(), body: 'I reported it last week too. The issue got approved but no action yet. Maybe if 10 people report the same spot it gets priority?', postedBy: 'citizen@mail.com', posterName: 'Ahmed K.', upvotes: [], date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      { _id: new ObjectId(), body: 'I can help organise a Sunday cleanup. Who is in? We need maybe 8 people and some bags.', postedBy: 'volunteer@mail.com', posterName: 'Rashida B.', upvotes: ['user1@mail.com'], date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    ],
  },
  {
    title: 'Street dog population in Dhanmondi is growing — what is the right response?',
    body: 'I love dogs but there are now 12 strays around Road 27 and some are getting aggressive near the school. I think we need a TNR (Trap-Neuter-Return) program. Is anyone connected to any NGO that does this?',
    category: 'General',
    postedBy: 'dogfriend@mail.com',
    posterName: 'Tahmina S.',
    upvotes: ['u1@m.com', 'u2@m.com'],
    upvoteCount: 2,
    isPinned: false,
    replies: [
      { _id: new ObjectId(), body: 'Dhaka Animal Welfare Society does TNR. I have used them before. Email contact@daws.org.bd', postedBy: 'helper@mail.com', posterName: 'Farhan H.', upvotes: [], date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ],
  },
  {
    title: 'Suggestion: Can we add a "resolved percentage" to the area health page?',
    body: 'It would be really motivating to see something like "Ward 12 has resolved 72% of reported issues this month". Right now the health score is good but I cannot tell what is actually improving.',
    category: 'Suggestions',
    postedBy: 'datadriven@mail.com',
    posterName: 'Imran R.',
    upvotes: ['a@m.com', 'b@m.com', 'c@m.com', 'd@m.com'],
    upvoteCount: 4,
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
    upvoteCount: 5,
    isPinned: false,
    replies: [
      { _id: new ObjectId(), body: 'Same in our area. I submitted an issue report with coordinates. If everyone upvotes it maybe it gets assigned.', postedBy: 'rain@mail.com', posterName: 'Nadia F.', upvotes: [], date: new Date() },
    ],
  },
  {
    title: 'Monthly meetup idea — should we do a CivicNest community walk?',
    body: 'What if once a month, community members from each ward do a 30-minute walk together identifying issues? We report them live on the app. Makes it social and productive at the same time.',
    category: 'Events',
    postedBy: 'walker@mail.com',
    posterName: 'Sadia M.',
    upvotes: ['p@m.com', 'q@m.com'],
    upvoteCount: 2,
    isPinned: false,
    replies: [],
  },
];

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('forum');
  
  await col.deleteMany({});
  
  const docs = FORUM_THREADS.map((thread, i) => {
    const lastReply = thread.replies.length > 0 
      ? { senderName: thread.replies[thread.replies.length - 1].posterName, preview: thread.replies[thread.replies.length - 1].body.substring(0, 60) }
      : null;
    return {
      ...thread,
      replyCount: thread.replies.length,
      approvalStatus: 'approved',
      isLocked: false,
      date: new Date(Date.now() - i * 3 * 24 * 60 * 60 * 1000),
      ...(lastReply ? { lastReply } : {})
    };
  });
  
  await col.insertMany(docs);
  console.log('Forum collection has been reset successfully!');
  await client.close();
}

run().catch(console.error);
