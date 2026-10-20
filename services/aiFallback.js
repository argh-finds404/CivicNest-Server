/**
 * Built-in answers for the AI features, used when Gemini can't answer (no
 * key configured, quota used up, model overloaded). They are rule-based, so
 * they are less flexible than Gemini, but every AI button still gives the
 * user something useful instead of an error.
 */

const has = (text, words) => words.some((w) => text.includes(w));
const clean = (s, max = 2000) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

/** "the drain is blocked. smells bad" -> "The drain is blocked. Smells bad." */
function tidySentences(text) {
  const t = clean(text);
  if (!t) return "";
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  let out = sentences.join(" ");
  if (!/[.!?]$/.test(out)) out += ".";
  return out;
}

// ── Issue reports ────────────────────────────────────────────────────────────

const CATEGORY_RULES = [
  { words: ["garbage", "trash", "waste", "dump", "bin", "rubbish", "litter", "smell", "stink", "ময়লা", "আবর্জনা"], match: ["Garbage & Waste", "Garbage"], cost: 3000 },
  { words: ["pothole", "road", "crack", "footpath", "pavement", "speed breaker", "asphalt", "রাস্তা", "গর্ত"], match: ["Road Damage"], cost: 25000 },
  { words: ["flood", "waterlog", "water log", "standing water", "drain", "drainage", "sewer", "rain water", "জলাবদ্ধতা", "পানি"], match: ["Waterlogging"], cost: 15000 },
  { words: ["streetlight", "street light", "lamp", "electric", "wire", "power", "gas leak", "water supply", "pipe", "বিদ্যুৎ"], match: ["Utility Problems", "Utility Issue"], cost: 8000 },
  { words: ["bench", "park", "playground", "railing", "manhole", "cover", "broken", "vandal", "bus stop", "toilet"], match: ["Broken Public Property"], cost: 10000 },
  { words: ["illegal", "construction", "encroach", "building", "occupied footpath", "hawker"], match: ["Illegal Construction"], cost: 0 },
  { words: ["theft", "crime", "unsafe", "harass", "robbery", "fight", "drug", "dark alley", "snatch"], match: ["Safety & Crime", "Safety"], cost: 5000 },
  { words: ["tree", "pollution", "smoke", "noise", "mosquito", "dengue", "canal", "river", "air", "burning"], match: ["Environmental Issues"], cost: 6000 },
  { words: ["beggar", "child labour", "eve teasing", "social"], match: ["Social Problems"], cost: 0 },
];

const URGENCY_RULES = [
  { level: "emergency", words: ["fire", "live wire", "electrocut", "collapse", "gas leak", "child fell", "accident", "injured", "dying", "emergency"] },
  { level: "high", words: ["dangerous", "danger", "school", "hospital", "blocked", "overflow", "flood", "dengue", "deep", "night", "elderly", "worse"] },
  { level: "low", words: ["minor", "small", "cosmetic", "paint", "slightly"] },
];

function suggestIssue(description, categories) {
  const text = clean(description).toLowerCase();
  let category;
  let cost = 5000;
  for (const rule of CATEGORY_RULES) {
    if (has(text, rule.words)) {
      category = categories.find((c) => rule.match.includes(c));
      cost = rule.cost;
      if (category) break;
    }
  }
  const urgency = (URGENCY_RULES.find((r) => has(text, r.words)) || { level: "medium" }).level;
  return {
    ...(category ? { category } : {}),
    urgency,
    polishedDescription: tidySentences(description),
    estimatedCostBDT: cost,
  };
}

// ── Animal first aid ─────────────────────────────────────────────────────────

const ANIMAL_RULES = [
  {
    words: ["bleed", "blood", "wound", "cut", "bite"],
    steps: [
      "Approach slowly and speak calmly; an injured animal may bite out of fear.",
      "Press a clean cloth firmly on the wound for 5 minutes to slow the bleeding.",
      "Do not apply ointments or home remedies to deep wounds.",
      "Keep the animal warm and still, then take it to a vet as soon as possible.",
    ],
    urgency: "HIGH",
  },
  {
    words: ["hit", "car", "accident", "fracture", "broken leg", "limp", "can't walk", "cannot walk", "paralys"],
    steps: [
      "Move the animal off the road only if it is safe for you to do so.",
      "Slide a board, blanket or flattened box underneath to carry it without bending the spine.",
      "Don't try to straighten a limb that looks broken.",
      "Keep it quiet and shaded and get it to a vet; internal injuries are common after accidents.",
    ],
    urgency: "EMERGENCY",
  },
  {
    words: ["poison", "foam", "seizure", "shaking", "vomit"],
    steps: [
      "Keep people and other animals away and note anything it may have eaten.",
      "Do not make the animal vomit and do not give milk or oil.",
      "Keep it on its side in a quiet, shaded place.",
      "Contact a vet immediately; poisoning can be fatal within hours.",
    ],
    urgency: "EMERGENCY",
  },
  {
    words: ["puppy", "kitten", "baby", "newborn", "abandoned", "mother"],
    steps: [
      "Watch from a distance for an hour first; the mother may be nearby looking for food.",
      "If the young are alone, keep them warm in a box with a soft cloth.",
      "Don't give cow's milk; it upsets their stomachs. Offer a little water only.",
      "Contact a rescue group or vet for proper formula feeding.",
    ],
    urgency: "MEDIUM",
  },
  {
    words: ["skin", "mange", "itch", "fur", "rash", "tick", "flea"],
    steps: [
      "Avoid touching the skin with bare hands and wash your hands afterwards.",
      "Offer clean water and food to build strength.",
      "Don't apply kerosene or chemicals; they burn the skin.",
      "A vet can treat mange and ticks with simple medicine.",
    ],
    urgency: "LOW",
  },
  {
    words: ["heat", "hot", "panting", "thirst", "dehydrat", "weak", "starv", "thin", "hungry"],
    steps: [
      "Move the animal into the shade.",
      "Offer small amounts of clean, cool (not ice-cold) water.",
      "Wet its paws and belly with cool water to bring the temperature down.",
      "Give plain food such as rice with boiled chicken or fish, then contact a vet if it stays weak.",
    ],
    urgency: "MEDIUM",
  },
];

function animalTip(animalType, condition) {
  const text = `${clean(animalType)} ${clean(condition)}`.toLowerCase();
  const rule = ANIMAL_RULES.find((r) => has(text, r.words)) || {
    steps: [
      "Keep a safe distance at first and watch how the animal moves and breathes.",
      "Offer clean water and plain food in a shaded spot.",
      "Take a clear photo and note the exact location so rescuers can find it.",
      "Contact a local vet or animal rescue group, and update the report here.",
    ],
    urgency: "MEDIUM",
  };
  const animal = clean(animalType, 40).toLowerCase() || "animal";
  return [
    `**First aid for the ${animal}:**`,
    ...rule.steps.map((s) => `- ${s}`),
    "",
    `**Urgency: ${rule.urgency}**`,
    "Volunteers on CivicNest can join this rescue from the animal's page.",
  ].join("\n");
}

// ── Complaint letter ─────────────────────────────────────────────────────────

function complaintLetter({ issueTitle, issueDescription, location, authority, ticketCode }) {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const where = clean(location, 200) || "our neighbourhood";
  const title = clean(issueTitle, 200);
  return [
    `Date: ${date}`,
    "",
    `To: ${authority || "The Chief Executive Officer, City Corporation"}`,
    "",
    `Subject: Request for urgent action on "${title}" at ${where}${ticketCode ? ` (CivicNest ref. ${ticketCode})` : ""}`,
    "",
    "Dear Sir/Madam,",
    "",
    `I am writing on behalf of the residents of ${where} to report the following problem: ${tidySentences(issueDescription)}`,
    "",
    "This problem affects the daily lives, health and safety of residents, including children and elderly people who use this area every day. It has been reported and verified by neighbours on the CivicNest community platform, where photos and updates are available.",
    "",
    "We respectfully request that your office inspect the site and arrange the necessary repair at the earliest opportunity, and inform us of the expected timeline. We are happy to provide any further information you need.",
    "",
    "Respectfully submitted,",
    "",
    "[Your Name]",
    "[Your Address]",
    "[Phone / Email]",
  ].join("\n");
}

// ── Summary ──────────────────────────────────────────────────────────────────

function summarize(content) {
  const text = clean(content, 3000);
  const issue = (text.match(/Issue:\s*(.*?)\.\s*Description:/i) || [])[1];
  const description = (text.match(/Description:\s*(.*?)(?:\.\s*Comments:|$)/i) || [])[1] || text;
  const comments = ((text.match(/Comments:\s*(.*)$/i) || [])[1] || "").split(".").map((c) => c.trim()).filter(Boolean);
  const firstSentences = description.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  const parts = [];
  if (issue) parts.push(`Residents reported "${issue}".`);
  if (firstSentences) parts.push(tidySentences(firstSentences));
  if (comments.length) {
    parts.push(`${comments.length} neighbour${comments.length === 1 ? " has" : "s have"} commented, for example: "${comments[0].slice(0, 140)}".`);
  } else {
    parts.push("No one has commented yet.");
  }
  return parts.join(" ");
}

// ── Spam check ───────────────────────────────────────────────────────────────

function spamCheck(title, description) {
  const text = `${clean(title)} ${clean(description)}`.toLowerCase();
  const letters = text.replace(/[^a-zঀ-৿]/g, "");
  const repeated = /(.)\1{5,}/.test(text);
  const testy = /\b(test|asdf|qwerty|lorem|dummy)\b/.test(text);
  const tooShort = letters.length < 15;
  const isSpam = repeated || testy || tooShort;
  return {
    isSpam,
    confidence: isSpam ? 70 : 20,
    reason: repeated ? "repeated characters" : testy ? "looks like a test post" : tooShort ? "too short to be a real report" : "looks like a genuine report",
  };
}

// ── CivicBot chat ────────────────────────────────────────────────────────────

const CHAT_TOPICS = [
  {
    words: ["hello", "hi ", "hey", "salam", "assalamu", "good morning", "good evening", "হ্যালো"],
    answer: "Hello! I'm **CivicBot**. I can help you report a problem, follow a ticket, join a cleanup or help an animal. What would you like to do?",
  },
  {
    words: ["report", "complain", "submit", "new issue", "file"],
    answer: [
      "### How to report a problem",
      "1. Open **Report issue** from the menu.",
      "2. Describe what you see; CivicNest suggests a category and urgency for you.",
      "3. Drop a pin on the map and add up to 5 photos.",
      "4. Submit. You get a ticket code like `CN-2026-000123` to follow under **My tickets**.",
      "",
      "A moderator reviews the report, then any member can claim it and fix it.",
    ].join("\n"),
  },
  {
    words: ["ticket", "track", "status", "progress", "cn-"],
    answer: [
      "### Following your report",
      "Every report gets a ticket code. Open **My tickets** to see its status and full history:",
      "- **Open**: waiting for review",
      "- **Triaged**: approved, waiting for someone to fix it",
      "- **In progress**: a member claimed it and has a 7-day deadline",
      "- **Resolved**: the fix was verified by 3 neighbours",
      "",
      "You can also type a code into **Track ticket** in the footer.",
    ].join("\n"),
  },
  {
    words: ["verify", "solve", "fix", "claim", "proof", "resolve"],
    answer: [
      "### How an issue gets solved",
      "1. A member **claims** an approved issue (7-day deadline).",
      "2. After fixing it, they upload **proof photos**.",
      "3. **Three other members** verify the fix (not the reporter or the fixer).",
      "4. The issue is **solved**: the fixer earns +50 points, the reporter +25 and each verifier +5.",
    ].join("\n"),
  },
  {
    words: ["point", "leaderboard", "rank", "badge", "streak", "reward"],
    answer: "You earn points for useful actions: reporting (+10), fixing an issue (+50), verifying a fix (+5), attending a cleanup (+30) and more. Daily activity builds a **streak**. See where you stand on the **Leaderboard**, and download your **Civic Impact Resume** from your profile.",
  },
  {
    words: ["member", "resident", "verify my", "membership", "guest", "upgrade"],
    answer: "New accounts start as **guests**. To become a **member**, send a residency request from your profile with your address and a utility bill photo. An admin approves it, and then you can claim issues, verify fixes, post in the forum and organise cleanups.",
  },
  {
    words: ["cleanup", "clean up", "drive", "volunteer", "event"],
    answer: "Open **Cleanup drives** to see upcoming events. Press **Going** to join; on the day the organiser shares a check-in code and you earn +30 points for attending. Members can **organise** a drive too; a moderator approves it before it is published.",
  },
  {
    words: ["dog", "cat", "animal", "stray", "puppy", "kitten", "bird", "injured animal"],
    answer: "If an animal needs help, open **Animal rescue → Report**, add a photo and the location. Volunteers nearby can join the rescue. On the animal's page, **First-aid tip** gives you immediate steps. If it is bleeding badly or was hit by a vehicle, take it to a vet straight away.",
  },
  {
    words: ["lost", "found", "wallet", "phone", "key", "missing item"],
    answer: "Use **Lost & Found**: post what you lost or found with a photo and the place. Owners can claim found items, and finders can respond to lost posts. When the item is returned, both people earn points.",
  },
  {
    words: ["donat", "fund", "pay", "money", "stripe", "bkash", "crowdfund"],
    answer: "You can fund a repair, an animal's treatment, a cleanup or an NGO by card (Stripe) or SSLCommerz. Money for an issue is **held until the fix is verified**, so it only goes to work that is really done.",
  },
  {
    words: ["moderator", "admin", "role", "staff"],
    answer: "Roles: **guest → member → moderator → admin**. Moderators review reports and cleanups, run the ticket desk and moderate the forum. Admins also manage users, membership requests, NGOs, notices and donations.",
  },
  {
    words: ["garbage", "trash", "waste", "dump"],
    answer: "For uncollected garbage: report it with a photo and the exact spot, mark urgency **high** if it blocks a road or drain, and ask neighbours to upvote it. The issue page can also generate a **formal complaint letter** to the city corporation.",
  },
  {
    words: ["pothole", "road", "footpath"],
    answer: "For a damaged road: report it with a photo showing the size of the damage and a pin on the map. If it is causing accidents, set urgency to **emergency**. Use **Escalate Government Complaint** on the issue page to send a formal letter.",
  },
  {
    words: ["flood", "waterlog", "drain", "rain"],
    answer: "For waterlogging: report the blocked drain or flooded street with photos. Standing water breeds mosquitoes, so mention it if it has lasted more than a day. Neighbours can join a cleanup drive to clear drains.",
  },
  {
    words: ["mosquito", "dengue"],
    answer: "To fight dengue: empty standing water from pots, tyres and roofs every few days, keep drains clear, and report stagnant water or blocked drains on CivicNest so the area can be cleaned.",
  },
  {
    words: ["emergency", "fire", "police", "ambulance", "danger", "999"],
    answer: "**If anyone is in danger, call 999** (national emergency service for police, fire and ambulance) first. After that, you can report the problem on CivicNest so it gets fixed for good.",
  },
  {
    words: ["thank", "thanks", "ধন্যবাদ"],
    answer: "You're welcome! Thank you for looking after your neighbourhood. 🌱",
  },
];

const CHAT_DEFAULT = [
  "I can help with:",
  "- **Reporting a problem** and following its ticket",
  "- **How issues get fixed** and verified",
  "- **Cleanup drives**, **animal rescue** and **lost & found**",
  "- **Points, membership** and **donations**",
  "",
  "Try asking: *\"How do I report a broken streetlight?\"*",
].join("\n");

function chat(message, mode = "general") {
  const text = ` ${clean(message).toLowerCase()} `;
  if (mode === "issue-helper") {
    const s = suggestIssue(message, CATEGORY_RULES.flatMap((r) => r.match));
    return [
      "### Suggested report",
      s.category ? `**Category:** ${s.category}` : null,
      `**Urgency:** ${s.urgency}`,
      "",
      `**Description:** ${s.polishedDescription}`,
      "",
      s.estimatedCostBDT ? `**Rough repair cost:** about ৳${s.estimatedCostBDT.toLocaleString("en-US")}` : null,
      "",
      "Add clear photos and a pin on the map when you submit.",
    ].filter((l) => l !== null).join("\n");
  }
  if (mode === "animal-tip") {
    const type = (text.match(/\b(dog|cat|puppy|kitten|bird|cow|goat)\b/) || [])[1] || "animal";
    return animalTip(type, message);
  }
  if (mode === "complaint-letter") {
    return complaintLetter({ issueTitle: "Civic problem in our area", issueDescription: message });
  }
  if (mode === "summarize") return summarize(message);
  const topic = CHAT_TOPICS.find((t) => has(text, t.words));
  return topic ? topic.answer : CHAT_DEFAULT;
}

module.exports = { chat, suggestIssue, animalTip, complaintLetter, summarize, spamCheck };
