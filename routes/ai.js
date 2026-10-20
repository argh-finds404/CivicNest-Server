const express = require('express');
const router  = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { verifyToken }  = require('../middleware/auth');
const fallback = require('../services/aiFallback');

// ── Gemini setup ──────────────────────────────────────────────────────────────
// The key can live under any of the usual names, so a differently named
// variable on the host doesn't silently switch the AI off.
const KEY_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_KEY'];
const keyVar = KEY_VARS.find((name) => (process.env[name] || '').trim());
const genAI = keyVar ? new GoogleGenerativeAI(process.env[keyVar].trim()) : null;

// Tried in order. A retired model (404) is skipped from then on; a busy one
// (quota, overload, timeout) is rested for a short while.
const MODELS = [...new Set([
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
].filter(Boolean))];
const MAX_TRIES = 3;
const REQUEST_TIMEOUT_MS = 20000;
const REST_MS = 30000;
const retired = new Set();
const restingUntil = new Map();
let workingModel = null;
let lastError = keyVar ? null : 'No Gemini API key is set (GEMINI_API_KEY).';

const shortError = (err) => String(err?.message || err || 'unknown error').replace(/key=[^&\s]+/gi, 'key=***').slice(0, 200);

/**
 * Run a Gemini call, trying up to MAX_TRIES models. `run(model)` gets a model
 * instance and returns the reply text. Throws if no model answers.
 */
async function askGemini(run, { system } = {}) {
  if (!genAI) throw new Error(lastError);
  const order = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  const candidates = order.filter((m) => !retired.has(m) && (restingUntil.get(m) || 0) <= Date.now());
  let lastErr = new Error('Every Gemini model is busy right now.');
  for (const name of candidates.slice(0, MAX_TRIES)) {
    try {
      const model = genAI.getGenerativeModel(
        { model: name, ...(system ? { systemInstruction: system } : {}) },
        { timeout: REQUEST_TIMEOUT_MS }
      );
      const text = String((await run(model)) || '').trim();
      if (!text) throw new Error('Gemini returned an empty reply');
      if (workingModel !== name) console.log(`[AI] answering with ${name}`);
      workingModel = name;
      lastError = null;
      return text;
    } catch (err) {
      lastErr = err;
      const message = err?.message || '';
      if (err?.status === 401 || err?.status === 403 || /api key not valid|api_key_invalid|permission denied/i.test(message)) {
        lastError = `The Gemini API key was rejected: ${shortError(err)}`;
        console.error(`[AI] ${lastError}`);
        throw err;
      }
      if (err?.status === 404 || /not found|is not supported|no longer available|deprecated/i.test(message)) {
        retired.add(name);
      } else {
        restingUntil.set(name, Date.now() + REST_MS);
      }
      console.warn(`[AI] ${name} failed: ${shortError(err)}`);
    }
  }
  lastError = shortError(lastErr);
  throw lastErr;
}

const generate = (prompt, options) =>
  askGemini(async (model) => (await model.generateContent(prompt)).response.text(), options);

// Helper to extract JSON from Gemini text output safely (removing code fences if present)
function safeJsonParse(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i) || trimmed.match(/(\{[\s\S]*\})/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        // fall through to the original error
      }
    }
    throw err;
  }
}

// ── Rate limit helper ─────────────────────────────────────────────────────────
// Per-user daily cap on Gemini calls, kept in memory. Past the cap the built-in
// answers take over, so the feature keeps working without spending quota.
const dailyUsage = new Map();
function checkUserLimit(email, limit = 20) {
  const today = new Date().toDateString();
  const key   = `${email}:${today}`;
  // Drop yesterday's counters so the map doesn't grow forever
  if (!dailyUsage.has(key)) {
    for (const k of dailyUsage.keys()) if (!k.endsWith(today)) dailyUsage.delete(k);
  }
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
  } catch {
    req.user = null;
    next();
  }
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/ai/status — is Gemini configured and answering? (no secrets)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/status', (req, res) => {
  res.json({
    configured: !!genAI,
    keyVariable: keyVar || null,
    model: workingModel || (MODELS.find((m) => !retired.has(m)) ?? null),
    retiredModels: [...retired],
    lastError,
    fallback: 'Built-in answers are used whenever Gemini cannot answer.',
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/chat — CivicBot main chat
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/chat', optionalVerifyToken, async (req, res) => {
  const { messages, mode = 'general' } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ message: 'Messages required.' });

  const systemPrompts = {
    general:          "You are CivicBot, a highly advanced AI assistant for CivicNest — a Bangladesh community civic platform. Help users with civic issues, community problems, and local governance. Respond in the user's language (Bengali or English). Be extremely professional, concise, practical, and highly helpful. Provide structured markdown responses with clear headings, lists, or bold highlights where appropriate.",
    'issue-helper':   "Help the user write a clear civic issue report. Suggest: (1) best category from [Garbage, Road Damage, Illegal Construction, Waterlogging, Broken Property, Safety], (2) a polished 2-3 sentence description, (3) estimated fix cost in BDT.",
    'animal-tip':     "Give immediate first-aid advice for a stray animal. User describes the animal type and condition. Provide highly readable, structured first-aid steps. Include: (1) IMMEDIATE STEPS (formatted as bullet points), (2) URGENCY LEVEL (formatted in bold), (3) WHO TO CONTACT (animal rescue NGOs / local vets). Be specific, actionable, and encouraging.",
    'complaint-letter': "Generate a formal, highly polished complaint letter in Bengali and English addressed to the relevant Bangladesh City Corporation department. Structure: Date, Recipient, Subject, 3 paragraphs (problem, impact, requested action), Closing, Signature placeholder. Format with clean spacing and formal margins.",
    'summarize':      "Summarize the following civic issue or forum thread in 3-4 sentences. Focus on: what the problem is, current status, and community response.",
  };

  // Earlier turns go in as history so follow-up questions have context.
  // Gemini wants it to start with a user turn and alternate user/model.
  const turns = messages
    .slice(-10)
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content.slice(0, 4000) }] }));
  const last = turns.pop();
  if (!last || last.role !== 'user') return res.status(400).json({ message: 'The last message must come from the user.' });
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const history = [];
  for (const turn of turns) {
    if (history.length && history[history.length - 1].role === turn.role) {
      history[history.length - 1].parts[0].text += `\n\n${turn.parts[0].text}`;
    } else {
      history.push(turn);
    }
  }
  if (history.length && history[history.length - 1].role === 'user') history.pop();

  const userIdentifier = req.user?.email || `guest:${req.ip}`;
  if (checkUserLimit(userIdentifier, 30)) {
    try {
      const response = await askGemini(async (model) => {
        const chat = model.startChat({
          history,
          // Room for the model's thinking as well as the reply, so answers aren't cut off
          generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
        });
        return (await chat.sendMessage(last.parts[0].text)).response.text();
      }, { system: systemPrompts[mode] || systemPrompts.general });
      return res.json({ response, source: 'gemini' });
    } catch (err) {
      console.error('[AI Chat Error]', shortError(err));
    }
  }
  res.json({ response: fallback.chat(last.parts[0].text, mode), source: 'built-in' });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/suggest-issue — auto-tag category from description
// Called on AddIssue.jsx after user finishes typing description
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/suggest-issue', verifyToken, async (req, res) => {
  const { description } = req.body || {};
  if (!description) return res.status(400).json({ message: 'Description required.' });
  // The form sends its own category list so the suggestion is always one it can show
  const categories = Array.isArray(req.body.categories) && req.body.categories.length
    ? req.body.categories.filter((c) => typeof c === 'string').slice(0, 20)
    : ['Garbage & Waste', 'Road Damage', 'Waterlogging', 'Illegal Construction', 'Broken Public Property', 'Utility Problems', 'Social Problems', 'Environmental Issues', 'Safety & Crime', 'Community Norms'];

  if (checkUserLimit(req.user.email, 50)) {
    try {
      const prompt = `
        A user submitted this civic issue description: "${String(description).slice(0, 2000)}"

        Respond ONLY with valid JSON, no markdown, no backticks:
        {
          "category": "exactly one of: ${categories.join(', ')}",
          "urgency": "one of: low, medium, high, emergency",
          "polishedDescription": "rewritten version in 2-3 clear sentences",
          "estimatedCostBDT": number
        }
      `;
      const json = safeJsonParse(await generate(prompt));
      if (json && typeof json === 'object') {
        if (!categories.includes(json.category)) delete json.category;
        return res.json({ ...json, source: 'gemini' });
      }
    } catch (err) {
      console.error('[AI Suggest Error]', shortError(err));
    }
  }
  res.json({ ...fallback.suggestIssue(description, categories), source: 'built-in' });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/animal-tip — first aid tip for a stray animal
// Public; Gemini answers are cached by type+condition and capped per visitor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const tipCache = new Map(); // simple in-memory cache

router.post('/animal-tip', async (req, res) => {
  const { animalType, condition } = req.body || {};
  if (!animalType || !condition) return res.status(400).json({ message: 'Required.' });

  const cacheKey = `${animalType}:${String(condition).substring(0, 50).toLowerCase()}`;
  if (tipCache.has(cacheKey)) {
    return res.json({ tip: tipCache.get(cacheKey), source: 'gemini' });
  }

  if (checkUserLimit(`tip:${req.ip}`, 40)) {
    try {
      const prompt = `
        A stray ${String(animalType).slice(0, 40)} has been reported with this condition: "${String(condition).slice(0, 500)}"

        Give immediate practical first-aid advice in 3-4 short sentences.
        Assume no vet is immediately available.
        Be specific and actionable.
        End with urgency level: LOW / MEDIUM / HIGH / EMERGENCY
      `;
      const tip = await generate(prompt);
      tipCache.set(cacheKey, tip);
      setTimeout(() => tipCache.delete(cacheKey), 24 * 60 * 60 * 1000); // cache 24h
      return res.json({ tip, source: 'gemini' });
    } catch (err) {
      console.error('[AI Tip Error]', shortError(err));
    }
  }
  res.json({ tip: fallback.animalTip(animalType, condition), source: 'built-in' });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/complaint-letter — formal complaint letter
// The issue page calls /complaint-letter; /generate-letter is kept for older clients
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post(['/generate-letter', '/complaint-letter'], verifyToken, async (req, res) => {
  const { issueTitle, issueDescription, location, authority, ticketCode } = req.body || {};
  if (!issueTitle || !issueDescription) {
    return res.status(400).json({ message: 'The issue title and description are needed for the letter.' });
  }

  if (checkUserLimit(`letter:${req.user.email}`, 5)) {
    try {
      const prompt = `
        Write a formal complaint letter (English only) to ${authority || 'the City Corporation'}.

        Issue: ${String(issueTitle).slice(0, 200)}
        Location: ${String(location || 'Not specified').slice(0, 200)}
        Reference: ${ticketCode ? String(ticketCode).slice(0, 40) : 'Not specified'}
        Details: ${String(issueDescription).slice(0, 2000)}

        Structure:
        Date: ${new Date().toLocaleDateString('en-BD')}
        To: The Authority
        Subject: (one line)
        Body: 3 paragraphs (problem, impact, request for action)
        Closing: Respectfully submitted
        Signature: [Your Name], [Your Address]

        Keep it formal, factual, and under 300 words.
      `;
      return res.json({ letter: await generate(prompt), source: 'gemini' });
    } catch (err) {
      console.error('[AI Letter Error]', shortError(err));
    }
  }
  res.json({ letter: fallback.complaintLetter({ issueTitle, issueDescription, location, authority, ticketCode }), source: 'built-in' });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/summarize — summarize issue thread or forum thread
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/summarize', verifyToken, async (req, res) => {
  const { content, type = 'issue' } = req.body || {};
  if (!content) return res.status(400).json({ message: 'Content required.' });

  if (checkUserLimit(`summary:${req.user.email}`, 15)) {
    try {
      const prompt = `Summarize this ${String(type).slice(0, 20)} in 3-4 sentences. Include: what the problem is, current status, and community response. Content: ${String(content).substring(0, 3000)}`;
      return res.json({ summary: await generate(prompt), source: 'gemini' });
    } catch (err) {
      console.error('[AI Summary Error]', shortError(err));
    }
  }
  res.json({ summary: fallback.summarize(content), source: 'built-in' });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/ai/detect-spam — Returns { isSpam: bool, reason: string }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/detect-spam', verifyToken, async (req, res) => {
  const { title, description } = req.body || {};
  if (checkUserLimit(`spam:${req.user.email}`, 50)) {
    try {
      const prompt = `
        Is this a legitimate civic issue report or spam/test/gibberish?
        Title: "${String(title || '').slice(0, 200)}"
        Description: "${String(description || '').slice(0, 2000)}"

        Respond ONLY with JSON (no markdown):
        { "isSpam": boolean, "confidence": 0-100, "reason": "brief reason" }
      `;
      return res.json({ ...safeJsonParse(await generate(prompt)), source: 'gemini' });
    } catch (err) {
      console.error('[AI Spam Error]', shortError(err));
    }
  }
  res.json({ ...fallback.spamCheck(title, description), source: 'built-in' });
});

module.exports = router;
