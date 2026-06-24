const express = require('express');
const router  = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { verifyToken }  = require('../middleware/auth');
const { getCollection } = require('../config/db');

const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

// Model router — using gemini-2.5-flash as it is fully supported by the API key
const model = (complex = false) =>
  genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
  });

// Helper to extract JSON from Gemini text output safely (removing code fences if present)
function safeJsonParse(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    // Try to extract content inside markdown code fences
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch (innerErr) {
        // Fallback or rethrow original error
      }
    }
    throw err;
  }
}

// ── Rate limit helper ─────────────────────────────────────────────────────────
// Simple per-user daily limit stored in memory (reset at midnight)
const dailyUsage = new Map();
function checkUserLimit(email, limit = 20) {
  const today = new Date().toDateString();
  const key   = `${email}:${today}`;
  const count = dailyUsage.get(key) || 0;
  if (count >= limit) return false;
  dailyUsage.set(key, count + 1);
  return true;
}


// Optional token verification for guest chatbot access
const optionalVerifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const admin = require("../config/firebase");
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { 
      email: decoded.email, 
      uid: decoded.uid,
      name: decoded.name,
      picture: decoded.picture,
    };
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/chat — CivicBot main chat
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/chat', optionalVerifyToken, async (req, res) => {
  const userIdentifier = req.user?.email || `guest:${req.ip}`;
  if (!checkUserLimit(userIdentifier, 30)) {
    return res.status(429).json({ message: 'Daily AI limit reached. Try again tomorrow.' });
  }

  const { messages, mode = 'general' } = req.body;
  if (!messages?.length) return res.status(400).json({ message: 'Messages required.' });

  const systemPrompts = {
    general:          "You are CivicBot, a highly advanced AI assistant for CivicNest — a Bangladesh community civic platform. Help users with civic issues, community problems, and local governance. Respond in the user's language (Bengali or English). Be extremely professional, concise, practical, and highly helpful. Provide structured markdown responses with clear headings, lists, or bold highlights where appropriate.",
    'issue-helper':   "Help the user write a clear civic issue report. Suggest: (1) best category from [Garbage, Road Damage, Illegal Construction, Waterlogging, Broken Property, Safety], (2) a polished 2-3 sentence description, (3) estimated fix cost in BDT.",
    'animal-tip':     "Give immediate first-aid advice for a stray animal. User describes the animal type and condition. Provide highly readable, structured first-aid steps. Include: (1) IMMEDIATE STEPS (formatted as bullet points), (2) URGENCY LEVEL (formatted in bold), (3) WHO TO CONTACT (animal rescue NGOs / local vets). Be specific, actionable, and encouraging.",
    'complaint-letter': "Generate a formal, highly polished complaint letter in Bengali and English addressed to the relevant Bangladesh City Corporation department. Structure: Date, Recipient, Subject, 3 paragraphs (problem, impact, requested action), Closing, Signature placeholder. Format with clean spacing and formal margins.",
    'summarize':      "Summarize the following civic issue or forum thread in 3-4 sentences. Focus on: what the problem is, current status, and community response.",
  };

  try {
    const chat = model(true).startChat({
      history: [],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
    });

    const systemNote = systemPrompts[mode] || systemPrompts.general;
    const userMessage = `[Context: ${systemNote}]\n\n${messages[messages.length - 1].content}`;

    const result   = await chat.sendMessage(userMessage);
    const response = result.response.text();

    res.json({ response });
  } catch (err) {
    console.error('[AI Chat Error]', err.message);
    res.status(500).json({ message: 'AI unavailable. Please try again.' });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/suggest-issue — auto-tag category from description
// Called on AddIssue.jsx after user finishes typing description
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/suggest-issue', verifyToken, async (req, res) => {
  if (!checkUserLimit(req.user.email, 50)) {
    return res.status(429).json({ message: 'Limit reached.' });
  }

  const { description } = req.body;
  if (!description) return res.status(400).json({ message: 'Description required.' });

  try {
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

    const result = await model(false).generateContent(prompt);
    const text   = result.response.text().trim();
    const json   = safeJsonParse(text);

    res.json(json);
  } catch (err) {
    // If JSON parse fails or AI errors, return null — frontend handles gracefully
    res.json(null);
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/animal-tip — first aid tip for a stray animal
// Public — no auth needed, no limit per IP but cached by type+condition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const tipCache = new Map(); // simple in-memory cache

router.post('/animal-tip', async (req, res) => {
  const { animalType, condition } = req.body;
  if (!animalType || !condition) return res.status(400).json({ message: 'Required.' });

  const cacheKey = `${animalType}:${condition.substring(0, 50).toLowerCase()}`;
  if (tipCache.has(cacheKey)) {
    return res.json({ tip: tipCache.get(cacheKey) });
  }

  try {
    const prompt = `
      A stray ${animalType} has been reported with this condition: "${condition}"
      
      Give immediate practical first-aid advice in 3-4 short sentences.
      Assume no vet is immediately available.
      Be specific and actionable.
      End with urgency level: LOW / MEDIUM / HIGH / EMERGENCY
    `;
    const result = await model(false).generateContent(prompt);
    const tip    = result.response.text().trim();
    tipCache.set(cacheKey, tip);
    setTimeout(() => tipCache.delete(cacheKey), 24 * 60 * 60 * 1000); // cache 24h
    res.json({ tip });
  } catch {
    res.json({ tip: null });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/generate-letter — formal complaint letter
// Member only
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/generate-letter', verifyToken, async (req, res) => {
  if (!checkUserLimit(req.user.email, 5)) {
    return res.status(429).json({ message: 'Letter generation limit reached (5/day).' });
  }

  const { issueTitle, issueDescription, location, authority } = req.body;

  try {
    const prompt = `
      Write a formal complaint letter (English only) to ${authority || 'the City Corporation'}.
      
      Issue: ${issueTitle}
      Location: ${location}
      Details: ${issueDescription}
      
      Structure:
      Date: ${new Date().toLocaleDateString('en-BD')}
      To: The Authority
      Subject: (one line)
      Body: 3 paragraphs (problem, impact, request for action)
      Closing: Respectfully submitted
      Signature: [Your Name], [Your Address]
      
      Keep it formal, factual, and under 300 words.
    `;
    const result = await model(true).generateContent(prompt);
    res.json({ letter: result.response.text() });
  } catch {
    res.status(500).json({ message: 'Letter generation failed.' });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/summarize — summarize issue thread or forum thread
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/summarize', verifyToken, async (req, res) => {
  if (!checkUserLimit(req.user.email, 15)) {
    return res.status(429).json({ message: 'Limit reached.' });
  }

  const { content, type = 'issue' } = req.body;
  if (!content) return res.status(400).json({ message: 'Content required.' });

  try {
    const prompt = `Summarize this ${type} in 3-4 sentences. Include: what the problem is, current status, and community response. Content: ${content.substring(0, 3000)}`;
    const result = await model(false).generateContent(prompt);
    res.json({ summary: result.response.text() });
  } catch {
    res.status(500).json({ message: 'Summarization failed.' });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/detect-spam — called internally when new issue is submitted
// Returns { isSpam: bool, reason: string }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/detect-spam', async (req, res) => {
  const { title, description } = req.body;
  try {
    const prompt = `
      Is this a legitimate civic issue report or spam/test/gibberish?
      Title: "${title}"
      Description: "${description}"
      
      Respond ONLY with JSON (no markdown):
      { "isSpam": boolean, "confidence": 0-100, "reason": "brief reason" }
    `;
    const result = await model(false).generateContent(prompt);
    const json   = safeJsonParse(result.response.text());
    res.json(json);
  } catch {
    res.json({ isSpam: false, confidence: 0, reason: 'check failed' });
  }
});

module.exports = router;
