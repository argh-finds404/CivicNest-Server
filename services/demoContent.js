/**
 * Demo content so a reviewer opening the live app sees a lived-in
 * neighbourhood: community members, issues at every stage (with tickets,
 * comments, votes and proofs), cleanup drives, animal rescues and lost &
 * found posts around Dhaka.
 *
 * Every record has a fixed id and `isDemo: true`:
 *  - seedDemoContent()               adds anything missing (safe on every start)
 *  - seedDemoContent({ reset: true }) removes the demo records and adds them fresh
 * Real user content is never touched.
 *
 * Images are bundled with the client in /public/demo, so they always load.
 */
const { ObjectId } = require("mongodb");
const Issue = require("../models/Issue");
const CleanupEvent = require("../models/CleanupEvent");
const Comment = require("../models/Comment");
const { createTicketForIssue } = require("./tickets");
const { prisma } = require("../lib/prisma");

const DAY = 24 * 60 * 60 * 1000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 60 * 60 * 1000);
const ahead = (days) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(2, 0, 0, 0); // 8:00 AM in Dhaka
  return d;
};
const img = (name) => `/demo/${name}.svg`;
// Stable ids: "de" + kind + number, padded to 24 hex characters
const demoId = (kind, n) => new ObjectId(`de${kind}${String(n).padStart(20 - kind.length + 2, "0")}`.slice(0, 24).padEnd(24, "0"));

// ── Community members ────────────────────────────────────────────────────────
const MEMBERS = [
  { slug: "farhana", name: "Farhana Akter", area: "Banani", points: 1240, streak: 18, avatar: 2 },
  { slug: "rakib", name: "Rakib Hossain", area: "Mirpur 10", points: 1085, streak: 11, avatar: 1 },
  { slug: "nusaiba", name: "Nusaiba Karim", area: "Dhanmondi", points: 960, streak: 9, avatar: 4 },
  { slug: "tanvir", name: "Tanvir Ahmed", area: "Gulshan", points: 870, streak: 14, avatar: 6 },
  { slug: "sadia", name: "Sadia Islam", area: "Uttara", points: 745, streak: 6, avatar: 5 },
  { slug: "arif", name: "Arif Chowdhury", area: "Mohammadpur", points: 630, streak: 4, avatar: 3 },
  { slug: "mithila", name: "Mithila Rahman", area: "Badda", points: 540, streak: 7, avatar: 10 },
  { slug: "imran", name: "Imran Kabir", area: "Farmgate", points: 455, streak: 3, avatar: 9 },
  { slug: "tasnim", name: "Tasnim Sultana", area: "Bashundhara", points: 380, streak: 5, avatar: 8 },
  { slug: "jamil", name: "Jamil Uddin", area: "Khilgaon", points: 290, streak: 2, avatar: 7 },
].map((m, i) => ({
  ...m,
  email: `${m.slug}@demo.civicnest.app`,
  uid: `demo-${m.slug}`,
  photoURL: img(`avatar-${m.avatar}`),
  memberId: `MEM-${String(41020 + i * 37)}`,
}));
const M = Object.fromEntries(MEMBERS.map((m) => [m.slug, m]));
const uids = (...slugs) => slugs.map((s) => M[s].uid);

function memberDoc(m, i) {
  return {
    email: m.email,
    uid: m.uid,
    name: m.name,
    photoURL: m.photoURL,
    role: "member",
    isDemo: true,
    isVolunteer: i % 3 === 0,
    memberId: m.memberId,
    area: m.area,
    points: m.points,
    issueCredits: 3,
    creditRegenTimestamps: [],
    streak: { current: m.streak, best: m.streak + 6, lastActiveDate: ago(0).toISOString().slice(0, 10) },
    verifiedAt: ago(60 - i * 3),
    createdAt: ago(90 - i * 4),
  };
}

const by = (slug) => ({ userId: M[slug].uid, name: M[slug].name, email: M[slug].email, memberId: M[slug].memberId, photoURL: M[slug].photoURL });

// ── Issues ───────────────────────────────────────────────────────────────────
const ISSUES = [
  {
    n: 1, reporter: "farhana", title: "Deep pothole outside Banani Road 11 school gate",
    description: "A pothole about a metre wide has opened right outside the school gate on Road 11. It fills with water after rain, so children and rickshaws can't see how deep it is. Two rickshaws have already tipped over this week.",
    category: "Road Damage", urgency: "high", area: "Banani", location: "Road 11, near the school gate", coords: [23.7937, 90.4066],
    images: ["issue-pothole"], status: "open", days: 3, upvotes: uids("rakib", "nusaiba", "tanvir", "sadia", "arif", "mithila", "imran"),
    crowdfunding: { enabled: true, targetAmount: 25000, purpose: "Asphalt and labour to patch the pothole properly", raisedAmount: 8500 },
    comments: [["rakib", "My son's rickshaw got stuck here yesterday morning. Please fix this before someone gets hurt."], ["sadia", "I've added ৳500 to the fund. Let's get this done before the next rain."], ["tanvir", "I can talk to the Ward 19 office about bringing a crew."]],
  },
  {
    n: 2, reporter: "rakib", title: "Overflowing garbage bin at Mirpur 10 bus stand",
    description: "The DNCC bin at the Mirpur 10 bus stand hasn't been emptied for five days. Bags are piled on the footpath, crows are tearing them open and the smell reaches the bus queue.",
    category: "Garbage & Waste", urgency: "high", area: "Mirpur 10", location: "Mirpur 10 roundabout bus stand", coords: [23.8069, 90.3687],
    images: ["issue-garbage"], status: "action_taken", days: 4, assignee: "tanvir", upvotes: uids("farhana", "nusaiba", "imran", "jamil", "tasnim"),
    comments: [["imran", "Same problem every Friday. The collection van skips this stop."], ["tanvir", "I've claimed this. Talking to the conservancy inspector tomorrow and organising a pickup."]],
  },
  {
    n: 3, reporter: "nusaiba", title: "Knee-deep waterlogging on Dhanmondi 27 after every rain",
    description: "Every time it rains for more than an hour, Road 27 near the Rapa Plaza crossing floods knee-deep. The roadside drain is clogged with plastic, so the water has nowhere to go and stays for a full day.",
    category: "Waterlogging", urgency: "high", area: "Dhanmondi", location: "Road 27, Rapa Plaza crossing", coords: [23.7561, 90.3740],
    images: ["issue-waterlogging"], status: "pending_verification", days: 9, assignee: "arif", upvotes: uids("farhana", "rakib", "tanvir", "sadia", "mithila", "imran", "tasnim", "jamil"),
    proof: { slug: "arif", images: ["cleanup-drain"], notes: "Cleared about 40 metres of the drain with eight volunteers and removed 15 bags of plastic. Water drained within 20 minutes after this morning's shower.", days: 1 },
    verifiedBy: uids("farhana", "tasnim"),
    comments: [["sadia", "Walked past after the rain today: the road was dry within half an hour. Great work!"], ["farhana", "Verified. Huge difference."]],
  },
  {
    n: 4, reporter: "tanvir", title: "Streetlight out on Gulshan Avenue side lane for two weeks",
    description: "The only streetlight in the lane behind Gulshan Avenue has been dark for two weeks. The lane is pitch black after 7 pm, and several people have reported phones being snatched there.",
    category: "Utility Problems", urgency: "medium", area: "Gulshan", location: "Lane behind Gulshan Avenue, Block CWN", coords: [23.7806, 90.4167],
    images: ["issue-streetlight"], status: "solved", days: 21, assignee: "rakib", upvotes: uids("farhana", "nusaiba", "sadia", "arif", "mithila"),
    proof: { slug: "rakib", images: ["issue-streetlight"], notes: "DNCC electrical team replaced the bulb and the faulty wiring. Light checked at 8 pm: working.", days: 6 },
    verifiedBy: uids("farhana", "nusaiba", "sadia"), resolvedDays: 5,
    comments: [["mithila", "Finally! The lane feels safe again."], ["nusaiba", "Verified this evening, it's bright now."]],
  },
  {
    n: 5, reporter: "sadia", title: "Open manhole without a cover on Uttara Sector 7 footpath",
    description: "The cover of the manhole on the main footpath of Sector 7, Road 15 is missing. It's hidden by leaves and someone could easily fall in, especially at night. A temporary sign has been put up but it keeps falling over.",
    category: "Broken Public Property", urgency: "emergency", area: "Uttara", location: "Sector 7, Road 15 footpath", coords: [23.8710, 90.3970],
    images: ["issue-drain"], status: "open", days: 1, upvotes: uids("farhana", "rakib", "tanvir", "arif"),
    comments: [["arif", "I nearly stepped in this last night. Very dangerous."]],
  },
  {
    n: 6, reporter: "arif", title: "Fallen tree blocking the lane in Mohammadpur Block C",
    description: "Last night's storm brought down a large tree across the lane in Block C. Cars and rickshaws can't get through, and the branches are resting on an electric cable.",
    category: "Environmental Issues", urgency: "high", area: "Mohammadpur", location: "Block C, Road 3", coords: [23.7580, 90.3580],
    images: ["issue-tree"], status: "open", days: 2, upvotes: uids("nusaiba", "imran", "jamil"),
    comments: [["imran", "Please don't touch the cable. I've called the power office as well."]],
  },
  {
    n: 7, reporter: "mithila", title: "Broken benches in the Shahbagh children's park",
    description: "Three of the benches in the children's corner are broken, with sharp edges and loose screws. Parents have nowhere to sit, and the broken planks are a hazard for small children.",
    category: "Broken Public Property", urgency: "low", area: "Shahbagh", location: "Children's corner, Shahbagh park", coords: [23.7380, 90.3960],
    images: ["issue-bench"], status: "open", days: 6, upvotes: uids("farhana", "tasnim"),
    crowdfunding: { enabled: true, targetAmount: 12000, purpose: "Timber and fittings for three benches", raisedAmount: 3200 },
    comments: [["tasnim", "I can help with the carpentry on a Friday if we get the timber."]],
  },
  {
    n: 8, reporter: "imran", title: "Plastic waste choking the Hatirjheel canal edge",
    description: "Plastic bottles and bags have collected along the canal edge near the bridge. The water has turned dark and smells, and mosquitoes are breeding in the still water.",
    category: "Environmental Issues", urgency: "medium", area: "Hatirjheel", location: "Canal edge near the Rampura bridge", coords: [23.7525, 90.4045],
    images: ["issue-canal"], status: "open", days: 5, upvotes: uids("rakib", "nusaiba", "tanvir", "sadia", "tasnim", "jamil"),
    comments: [["nusaiba", "We should make this the next cleanup drive."], ["rakib", "Agreed, count me in."]],
  },
  {
    n: 9, reporter: "jamil", title: "CCTV camera not working in the Badda market alley",
    description: "The CCTV camera covering the alley behind Badda market has been off for a month, and there have been two thefts since. Shop owners say nobody has come to check it.",
    category: "Safety & Crime", urgency: "medium", area: "Badda", location: "Alley behind Badda market", coords: [23.7806, 90.4260],
    images: ["issue-safety"], status: "open", days: 8, upvotes: uids("mithila", "imran"),
    comments: [],
  },
  {
    n: 10, reporter: "tasnim", title: "Garbage dump behind Farmgate market cleared",
    description: "An illegal dump had built up behind the Farmgate kitchen market, with rotting vegetables and plastic blocking the back lane.",
    category: "Garbage & Waste", urgency: "high", area: "Farmgate", location: "Back lane of Farmgate kitchen market", coords: [23.7577, 90.3897],
    images: ["issue-garbage"], status: "solved", days: 30, assignee: "farhana", upvotes: uids("rakib", "nusaiba", "tanvir", "arif", "imran", "jamil"),
    proof: { slug: "farhana", images: ["issue-garbage-cleared"], notes: "Cleared with the market committee and DNCC van; the committee now pays a cleaner twice a week.", days: 12 },
    verifiedBy: uids("rakib", "arif", "jamil"), resolvedDays: 11,
    comments: [["imran", "The lane is spotless now. Thank you!"]],
  },
  {
    n: 11, reporter: "farhana", title: "Long road crack on Bashundhara Road 8 repaired",
    description: "A long crack and a sunken patch on Bashundhara Road 8 made cars swerve into the other lane.",
    category: "Road Damage", urgency: "medium", area: "Bashundhara", location: "Road 8, Block D", coords: [23.8190, 90.4520],
    images: ["issue-pothole"], status: "solved", days: 40, assignee: "tasnim", upvotes: uids("tanvir", "sadia", "mithila", "tasnim"),
    proof: { slug: "tasnim", images: ["issue-pothole-fixed"], notes: "Patched by the R/A maintenance team after we shared the CivicNest ticket.", days: 20 },
    verifiedBy: uids("tanvir", "sadia", "mithila"), resolvedDays: 19,
    comments: [],
  },
  {
    n: 12, reporter: "jamil", title: "Illegal dumping next to the Khilgaon rail crossing",
    description: "Trucks have started dumping construction rubble and household waste next to the Khilgaon rail crossing at night. It's narrowing the road and blocking the drain.",
    category: "Garbage & Waste", urgency: "medium", area: "Khilgaon", location: "Khilgaon rail crossing", coords: [23.7510, 90.4250],
    images: ["issue-garbage"], status: "open", days: 0, pending: true, upvotes: [], comments: [],
  },
];

function issueDoc(d) {
  const submittedAt = ago(d.days, 3);
  const approved = !d.pending;
  const assignee = d.assignee ? M[d.assignee] : null;
  const doc = new Issue({
    _id: demoId("1", d.n),
    title: d.title,
    description: d.description,
    category: d.category,
    location: d.location,
    area: d.area,
    coordinates: { lat: d.coords[0], lng: d.coords[1] },
    images: d.images.map(img),
    incidentDate: ago(d.days, 6),
    submittedAt,
    updatedAt: submittedAt,
    submittedBy: by(d.reporter),
    approvalStatus: approved ? "approved" : "pending_review",
    approvedAt: approved ? ago(Math.max(d.days - 1, 0)) : null,
    approvedBy: approved ? "moderator.reviewer@civicnest.app" : null,
    status: d.status,
    statusChangedAt: ago(Math.max(d.days - 2, 0)),
    upvotes: d.upvotes,
    netScore: d.upvotes.length,
    commentCount: d.comments.length,
    urgency: d.urgency,
    verifications: d.verifiedBy || [],
    verificationCount: (d.verifiedBy || []).length,
    claimRewardedTo: assignee ? [assignee.email] : [],
    assignedTo: assignee
      ? {
          email: assignee.email, name: assignee.name, type: "volunteer", assignedAt: ago(d.days - 1),
          // Work still in progress keeps a deadline in the future
          deadline: d.status === "solved" ? new Date(ago(d.days - 1).getTime() + 7 * DAY) : new Date(Math.max(ago(d.days - 1).getTime() + 7 * DAY, Date.now() + 2 * DAY)),
          adminNote: null,
        }
      : { email: null, name: null, type: null, assignedAt: null, deadline: null, adminNote: null },
    resolutionProofs: d.proof
      ? [{ uploadedBy: M[d.proof.slug].email, uploadedAt: ago(d.proof.days), images: d.proof.images.map(img), notes: d.proof.notes, gpsMatch: "high" }]
      : [],
    resolvedAt: d.resolvedDays ? ago(d.resolvedDays) : null,
    crowdfunding: d.crowdfunding
      ? { ...d.crowdfunding, escrowStatus: d.status === "solved" ? "released" : "holding" }
      : { enabled: false },
  }).toObject();
  doc.isDemo = true;
  return doc;
}

function commentDocs(d) {
  return d.comments.map(([slug, body], i) => {
    const createdAt = new Date(ago(d.days).getTime() + (i + 1) * 3 * 60 * 60 * 1000);
    const c = new Comment({
      _id: demoId("2", d.n * 10 + i),
      issueId: demoId("1", d.n),
      userId: M[slug].uid,
      userName: M[slug].name,
      userEmail: M[slug].email,
      userAvatar: M[slug].photoURL,
      memberId: M[slug].memberId,
      body,
      createdAt: createdAt > new Date() ? new Date() : createdAt,
      likes: i === 0 ? uids("farhana", "tanvir").filter((u) => u !== M[slug].uid) : [],
    }).toObject();
    c.editWindow = new Date(c.createdAt.getTime() + 15 * 60000);
    c.isDemo = true;
    return c;
  });
}

// ── Cleanup drives ───────────────────────────────────────────────────────────
const attendees = (...slugs) => slugs.map((s, i) => ({ email: M[s].email, name: M[s].name, photoURL: M[s].photoURL, joinedAt: ago(4 - (i % 3)), status: "going" }));

const EVENTS = [
  {
    n: 1, title: "Hatirjheel Lake Cleanup Drive", slogan: "Let's give Hatirjheel its sparkle back", organizer: "nusaiba", inDays: 4,
    description: "Join neighbours for a two-hour cleanup of the Hatirjheel lake edge between the Rampura bridge and the amphitheatre. We'll collect plastic from the water's edge and sort it for recycling. Gloves, bags and water are provided.",
    address: "Hatirjheel amphitheatre steps", area: "Hatirjheel", coords: [23.7525, 90.4045], image: "cleanup-lake",
    going: ["rakib", "farhana", "imran", "sadia", "tasnim", "jamil", "mithila"], max: 40, skills: ["Physical Work", "Photography"], supplies: ["Gloves", "Bags", "Water"],
    funding: { goal: 8000, raised: 5200 },
  },
  {
    n: 2, title: "Plant 100 Trees in Mirpur", slogan: "One sapling for every family on the block", organizer: "rakib", inDays: 9,
    description: "We're planting 100 native saplings (neem, krishnachura and mango) along Mirpur Road 2 with the help of the local school. Bring a water bottle; spades and saplings are provided by Green Dhaka.",
    address: "Mirpur 2 stadium gate", area: "Mirpur", coords: [23.8058, 90.3626], image: "cleanup-trees",
    going: ["tanvir", "arif", "tasnim", "mithila"], max: 60, skills: ["Physical Work"], supplies: ["Spades", "Water", "Saplings"],
  },
  {
    n: 3, title: "Clear the Drains before Monsoon in Dhanmondi", slogan: "Clear drains, dry streets", organizer: "arif", inDays: 2,
    description: "A follow-up to the Road 27 waterlogging fix: we'll clear the remaining roadside drains on Road 27 and Road 32 before the monsoon. Wear shoes you don't mind getting dirty.",
    address: "Road 27 and Satmasjid Road crossing", area: "Dhanmondi", coords: [23.7550, 90.3720], image: "cleanup-drain",
    going: ["nusaiba", "farhana", "jamil"], max: 25, skills: ["Physical Work", "First Aid"], supplies: ["Rakes", "Bags", "Gloves"],
  },
  {
    n: 4, title: "Buriganga Riverbank Cleanup", slogan: "Our river, our responsibility", organizer: "tanvir", inDays: -10, completed: true,
    description: "Thirty volunteers cleared the riverbank at Sadarghat and collected more than 400 kg of plastic. Thank you to everyone who came!",
    address: "Sadarghat launch terminal", area: "Sadarghat", coords: [23.7058, 90.4074], image: "cleanup-riverbank",
    going: ["farhana", "rakib", "nusaiba", "sadia", "arif", "mithila", "imran", "tasnim", "jamil"], max: 50, skills: ["Physical Work"], supplies: ["Gloves", "Bags"],
  },
  {
    n: 5, title: "Lalmatia Pond Cleanup", slogan: "Bring the ducks back", organizer: "sadia", inDays: 12, pending: true,
    description: "The pond in Lalmatia Block D is full of plastic and water hyacinth. Let's clear it over a Saturday morning.",
    address: "Lalmatia Block D pond", area: "Lalmatia", coords: [23.7550, 90.3650], image: "cleanup-lake",
    going: [], max: 20, skills: ["Physical Work"], supplies: ["Gloves", "Bags"],
  },
];

function eventDoc(e) {
  const going = e.completed
    ? attendees(...e.going).map((a) => ({ ...a, status: "attended", checkedIn: true, checkedInAt: ahead(e.inDays), gpsConfidence: "high" }))
    : attendees(...e.going);
  const doc = new CleanupEvent({
    _id: demoId("3", e.n),
    title: e.title,
    slug: `demo-${e.n}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
    slogan: e.slogan,
    description: e.description,
    coverImages: [img(e.image)],
    postEventPhotos: e.completed ? [img(e.image)] : [],
    eventDate: ahead(e.inDays),
    eventTime: "8:00 AM",
    durationHours: 3,
    location: { address: e.address, area: e.area, coordinates: [e.coords[1], e.coords[0]] },
    organizer: { email: M[e.organizer].email, name: M[e.organizer].name, photoURL: M[e.organizer].photoURL },
    maxVolunteers: e.max,
    interested: e.going.slice(0, 2).map((s) => M[s].email),
    interestedCount: Math.min(2, e.going.length),
    going,
    goingCount: going.length,
    requiredSkills: e.skills,
    suppliesNeeded: e.supplies,
    meetingInstructions: `Meet at ${e.address} at 7:45 AM. Look for the green CivicNest banner.`,
    fundingEnabled: !!e.funding,
    fundingGoal: e.funding?.goal || 0,
    fundingRaised: e.funding?.raised || 0,
    approvalStatus: e.pending ? "pending_review" : "approved",
    approvedBy: e.pending ? null : "moderator.reviewer@civicnest.app",
    status: e.completed ? "completed" : "upcoming",
    pointsAwarded: !!e.completed,
  }).toObject();
  doc.createdAt = ago(Math.max(14 - e.n, 1));
  doc.updatedAt = doc.createdAt;
  doc.isDemo = true;
  return doc;
}

// ── Animal rescues ───────────────────────────────────────────────────────────
const volunteers = (...slugs) => slugs.map((s) => ({ email: M[s].email, name: M[s].name, photoURL: M[s].photoURL }));

const ANIMALS = [
  { n: 1, animalType: "Dog", condition: "Hit by a car, back leg injured and can't stand", urgency: "emergency", status: "needs-help", location: "Banani Road 12, beside the tea stall", area: "Banani", coords: [23.7952, 90.4038], image: "animal-dog", reporter: "farhana", days: 0, vols: ["rakib", "tanvir"] },
  { n: 2, animalType: "Dog", condition: "Three puppies abandoned in a box, about four weeks old", urgency: "high", status: "needs-help", location: "Mirpur 10, behind the bus stand", area: "Mirpur 10", coords: [23.8075, 90.3700], image: "animal-puppies", reporter: "rakib", days: 1, vols: ["sadia"] },
  { n: 3, animalType: "Cat", condition: "Kitten with an eye infection, very weak", urgency: "medium", status: "in-treatment", location: "Dhanmondi 15, near the lake", area: "Dhanmondi", coords: [23.7450, 90.3760], image: "animal-kitten", reporter: "nusaiba", days: 4, vols: ["nusaiba", "mithila"] },
  { n: 4, animalType: "Cat", condition: "Rescued and healthy, vaccinated and looking for a home", urgency: "low", status: "rescued", adoptable: true, location: "Gulshan 1, foster home", area: "Gulshan", coords: [23.7800, 90.4150], image: "animal-cat", reporter: "tanvir", days: 15, vols: ["tanvir"] },
  { n: 5, animalType: "Bird", condition: "Pigeon with a hurt wing, can't fly", urgency: "medium", status: "needs-help", location: "Farmgate footbridge stairs", area: "Farmgate", coords: [23.7585, 90.3890], image: "animal-bird", reporter: "imran", days: 2, vols: [] },
];

function animalDoc(a) {
  return {
    _id: demoId("4", a.n),
    animalType: a.animalType,
    condition: a.condition,
    urgency: a.urgency,
    status: a.status,
    ...(a.adoptable ? { adoptable: true } : {}),
    approvalStatus: "approved",
    location: a.location,
    area: a.area,
    coordinates: { lat: a.coords[0], lng: a.coords[1] },
    image: img(a.image),
    contactInfo: M[a.reporter].email,
    reporter: { email: M[a.reporter].email, name: M[a.reporter].name, photoURL: M[a.reporter].photoURL },
    volunteers: volunteers(...a.vols),
    volunteerCount: a.vols.length,
    date: ago(a.days, 2),
    createdAt: ago(a.days, 2),
    isDemo: true,
  };
}

// ── Lost & found ─────────────────────────────────────────────────────────────
const LOST_FOUND = [
  { n: 1, type: "lost", category: "documents", itemName: "Brown leather wallet with NID card", description: "Lost on the Banani to Gulshan rickshaw ride. It has my NID, a bank card and some cash. The NID matters most.", location: "Banani 11 to Gulshan 2", area: "Banani", coords: [23.7900, 90.4100], image: "lost-wallet", reward: 1000, reporter: "tasnim", days: 2 },
  { n: 2, type: "lost", category: "keys", itemName: "Bunch of house keys with a green tag", description: "Three keys on a ring with a green leather tag. Probably dropped near the Dhanmondi Lake jogging track.", location: "Dhanmondi Lake jogging track", area: "Dhanmondi", coords: [23.7470, 90.3790], image: "lost-keys", reward: 300, reporter: "nusaiba", days: 1 },
  { n: 3, type: "lost", category: "electronics", itemName: "Blue Android phone with a cracked screen", description: "Left on the Mirpur 10 metro station bench. It has a cracked screen protector and a transparent case.", location: "Mirpur 10 metro station", area: "Mirpur 10", coords: [23.8076, 90.3680], image: "lost-phone", reward: 2000, reporter: "jamil", days: 3 },
  { n: 4, type: "found", category: "other", itemName: "Blue school backpack", description: "Found a child's blue school backpack with books inside at the Uttara Sector 7 park. Contact me with the name written inside.", location: "Uttara Sector 7 park", area: "Uttara", coords: [23.8700, 90.3990], image: "found-backpack", reward: 0, reporter: "sadia", days: 1 },
  { n: 5, type: "found", category: "other", itemName: "Red umbrella left in a rickshaw", description: "A red umbrella with a curved black handle was left in my rickshaw near Farmgate. Describe it and it's yours.", location: "Farmgate, Indira Road", area: "Farmgate", coords: [23.7590, 90.3870], image: "found-umbrella", reward: 0, reporter: "imran", days: 0 },
];

function lostFoundDoc(l) {
  const date = ago(l.days, 4);
  return {
    _id: demoId("5", l.n),
    type: l.type,
    category: l.category,
    itemName: l.itemName,
    description: l.description,
    location: l.location,
    area: l.area,
    coordinates: { lat: l.coords[0], lng: l.coords[1] },
    dateLostFound: date,
    image: img(l.image),
    reward: l.reward,
    contactInfo: M[l.reporter].email,
    reporter: M[l.reporter].email,
    status: "open",
    date,
    expiresAt: new Date(Date.now() + 30 * DAY),
    notifiedExpiry: false,
    claims: [],
    foundReports: [],
    isDemo: true,
  };
}

// ── Seeding ──────────────────────────────────────────────────────────────────

/** Insert-if-missing for a batch of docs with fixed _ids */
async function upsertAll(collection, docs) {
  if (!docs.length) return 0;
  const result = await collection.bulkWrite(
    docs.map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })),
    { ordered: false }
  );
  return result.upsertedCount;
}

/**
 * @param db the communityDB database (native driver)
 * @param options.reset remove the demo records first, then add them fresh
 */
async function seedDemoContent(db, { reset = false } = {}) {
  const issueIds = ISSUES.map((d) => demoId("1", d.n));
  if (reset) {
    const demoEmails = MEMBERS.map((m) => m.email);
    await Promise.all([
      db.collection("issues").deleteMany({ _id: { $in: issueIds } }),
      db.collection("comments").deleteMany({ $or: [{ issueId: { $in: issueIds } }, { isDemo: true }] }),
      db.collection("cleanupevents").deleteMany({ isDemo: true }),
      db.collection("animals").deleteMany({ isDemo: true }),
      db.collection("lostFound").deleteMany({ isDemo: true }),
      db.collection("users").deleteMany({ email: { $in: demoEmails }, isDemo: true }),
      prisma.ticket.deleteMany({ where: { issueId: { in: issueIds.map(String) } } }).catch(() => null),
    ]);
  }

  const added = {};
  // Users are keyed by email (no fixed _id), so upsert them by email
  const userResult = await db.collection("users").bulkWrite(
    MEMBERS.map((m, i) => ({ updateOne: { filter: { email: m.email }, update: { $setOnInsert: memberDoc(m, i) }, upsert: true } })),
    { ordered: false }
  );
  added.members = userResult.upsertedCount;
  added.issues = await upsertAll(db.collection("issues"), ISSUES.map(issueDoc));
  added.comments = await upsertAll(db.collection("comments"), ISSUES.flatMap(commentDocs));
  added.events = await upsertAll(db.collection("cleanupevents"), EVENTS.map(eventDoc));
  added.animals = await upsertAll(db.collection("animals"), ANIMALS.map(animalDoc));
  added.lostFound = await upsertAll(db.collection("lostFound"), LOST_FOUND.map(lostFoundDoc));

  // Every demo issue gets its ticket, and approved ones move past OPEN
  let tickets = 0;
  const demoIssues = await db.collection("issues").find({ _id: { $in: issueIds } }).toArray();
  for (const issue of demoIssues) {
    if (issue.ticketCode) continue;
    const ticket = await createTicketForIssue(issue, { by: issue.submittedBy?.email });
    if (!ticket) continue;
    tickets++;
    const update = { ticketCode: ticket.code };
    await db.collection("issues").updateOne({ _id: issue._id }, { $set: update });
    if (issue.approvalStatus === "approved" && ticket.status === "OPEN") {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: "TRIAGED", events: { push: { type: "status", from: "OPEN", to: "TRIAGED", by: issue.approvedBy, note: "Report approved" } } },
      });
    }
    const assignee = issue.assignedTo?.email;
    if (assignee) {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { assigneeEmail: assignee } });
    }
  }
  added.tickets = tickets;

  // Keep upcoming demo drives in the future as the weeks go by
  const stale = await db.collection("cleanupevents").find({ isDemo: true, status: "upcoming", eventDate: { $lt: new Date() } }).toArray();
  for (const event of stale) {
    const n = EVENTS.find((e) => String(demoId("3", e.n)) === String(event._id));
    await db.collection("cleanupevents").updateOne({ _id: event._id }, { $set: { eventDate: ahead(Math.max(n?.inDays || 3, 2)) } });
  }
  // Keep in-progress demo work and demo listings current as the weeks go by
  await db.collection("issues").updateMany(
    { _id: { $in: issueIds }, status: { $in: ["action_taken", "pending_verification"] }, "assignedTo.deadline": { $lt: new Date() } },
    { $set: { "assignedTo.deadline": new Date(Date.now() + 3 * DAY) } }
  );
  await db.collection("lostFound").updateMany(
    { isDemo: true, status: "open", expiresAt: { $lt: new Date(Date.now() + 7 * DAY) } },
    { $set: { expiresAt: new Date(Date.now() + 30 * DAY) } }
  );
  return added;
}

module.exports = { seedDemoContent, DEMO_MEMBERS: MEMBERS };
