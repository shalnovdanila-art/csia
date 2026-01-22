// server/index.mjs
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------- BASIC SERVER SETUP ----------------

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

let ai = null;
if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
} else {
  console.warn(
    '⚠️ GEMINI_API_KEY is not set. AI calls will fall back to a static menu.'
  );
}

// ---------------- EMAIL (SMTP) ----------------

// The server sends emails from ONE sender mailbox (SMTP_USER) to many recipients (each registered user).
// Configure SMTP settings in server/.env. If not configured, menu generation still works (email just won't be sent).

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true') === 'true'; // true for port 465
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

let mailer = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  // Optional: validate SMTP credentials at startup (does NOT send an email)
  mailer.verify().catch((err) => {
    console.warn('⚠️ SMTP is configured but verify() failed:', err.message);
  });
} else {
  console.warn('⚠️ SMTP is not configured. Menu emails will not be sent.');
}

// ---------------- JSON "DATABASE" ----------------

const DB_PATH = path.join(__dirname, 'db.json');

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.users) parsed.users = [];
    if (!parsed.menus) parsed.menus = [];
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      const initial = { users: [], menus: [] };
      fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
      return initial;
    }
    console.error('Error reading DB:', err);
    return { users: [], menus: [] };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function findUser(email) {
  const db = readDb();
  return db.users.find((u) => u.email === email) || null;
}

function saveUser(user) {
  const db = readDb();
  const idx = db.users.findIndex((u) => u.email === user.email);
  if (idx === -1) db.users.push(user);
  else db.users[idx] = user;
  writeDb(db);
}

function getNextMenuVersion(email) {
  const db = readDb();
  const menus = db.menus.filter((m) => m.email === email);
  const maxVersion = menus.reduce(
    (max, m) => (typeof m.version === 'number' && m.version > max ? m.version : max),
    0
  );
  return maxVersion + 1;
}

function saveMenu(menu) {
  const db = readDb();
  db.menus.push(menu);
  writeDb(db);
}

// ---------------- CALORIE HELPERS ----------------

function approximateAge(ageRange) {
  if (!ageRange) return 30;
  if (ageRange.includes('-')) {
    const [from, to] = ageRange.split('-');
    if (to === '+') return Number(from) + 5;
    const f = Number(from);
    const t = Number(to);
    if (!Number.isNaN(f) && !Number.isNaN(t)) {
      return Math.round((f + t) / 2);
    }
  }
  return 30;
}

function activityFactor(level) {
  switch (level) {
    case 'Sedentary - 0 hours/week':
      return 1.2;
    case 'Light - 0-1 hour/week':
      return 1.375;
    case 'Moderate - 1-2 hours/week':
      return 1.55;
    case 'Active - 2-4 hours/week':
      return 1.725;
    case 'Very Active - 4+ hours/week':
      return 1.9;
    default:
      return 1.4;
  }
}

function calculateDailyCalories(profile) {
  const age = approximateAge(profile.ageRange);
  const weight = Number(profile.weightKg || 70);
  const height = Number(profile.heightCm || 170);
  const gender = profile.gender || 'Other';

  let bmr;
  if (gender === 'Male') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else if (gender === 'Female') {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  } else {
    const male = 10 * weight + 6.25 * height - 5 * age + 5;
    const female = 10 * weight + 6.25 * height - 5 * age - 161;
    bmr = (male + female) / 2;
  }

  let calories = bmr * activityFactor(profile.activityLevel);

  if (profile.goal === 'Lose weight') calories *= 0.8;
  else if (profile.goal === 'Gain weight') calories *= 1.15;

  return Math.round(calories);
}

// Extract JSON between first "{" and last "}"
function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('AI response is empty or not a string');
  }
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('Could not locate JSON object in AI response');
  }
  const jsonStr = cleaned.slice(first, last + 1);
  return JSON.parse(jsonStr);
}

// ---------------- EMAIL HELPERS ----------------

function menuToPlainText(menu) {
  const lines = [];
  lines.push('Nutrition Planning App');
  lines.push(`Weekly Menu (version ${menu.version})`);
  lines.push(`Target daily calories: ${menu.dailyCalories} kcal`);
  lines.push(`Generated at: ${new Date(menu.generatedAt).toLocaleString()}`);
  lines.push('');

  for (const day of menu.days || []) {
    lines.push(`${day.label || `Day ${day.dayIndex}`}`);

    for (const meal of day.meals || []) {
      const kcal = typeof meal.calories === 'number' ? ` (${meal.calories} kcal)` : '';
      lines.push(`- ${meal.type}: ${meal.name}${kcal}`);
      if (meal.description) {
        lines.push(`  ${meal.description}`);
      }
    }

    const items = day.shoppingItems || [];
    if (items.length) {
      lines.push('Shopping list:');
      for (const item of items) {
        lines.push(`• ${item.product} — ${item.quantity}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

async function sendMenuEmail(recipientEmail, menu) {
  if (!mailer) throw new Error('SMTP is not configured.');

  const subject = `Your weekly menu (v${menu.version}) — Nutrition Planning App`;
  const text = menuToPlainText(menu);

  return await mailer.sendMail({
    from: MAIL_FROM,
    to: recipientEmail,
    subject,
    text
  });
}

// ---------------- AUTH ROUTES ----------------

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const existing = findUser(email);
    if (existing) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      email,
      passwordHash,
      profile: null,
      createdAt: Date.now()
    };
    saveUser(user);

    return res.status(201).json({
      user: {
        email: user.email,
        profile: user.profile
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = findUser(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    return res.json({
      user: {
        email: user.email,
        profile: user.profile || null
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Get user by email (for "stay logged in")
app.get('/api/auth/user', (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ error: 'Email query parameter is required.' });
    }
    const user = findUser(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({
      user: {
        email: user.email,
        profile: user.profile || null
      }
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error loading user.' });
  }
});

// Update profile
app.put('/api/profile', (req, res) => {
  try {
    const { email, profile } = req.body || {};
    if (!email || !profile) {
      return res.status(400).json({ error: 'Email and profile are required.' });
    }
    const user = findUser(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    user.profile = {
      goal: profile.goal,
      ageRange: profile.ageRange,
      gender: profile.gender,
      heightCm: Number(profile.heightCm),
      weightKg: Number(profile.weightKg),
      activityLevel: profile.activityLevel
    };

    saveUser(user);

    return res.json({
      user: {
        email: user.email,
        profile: user.profile
      }
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error updating profile.' });
  }
});

// ---------------- MENU GENERATION (AI) ----------------

app.post('/api/generate-weekly-menu', async (req, res) => {
  const { email, profile } = req.body || {};

  try {
    if (!email || !profile) {
      return res.status(400).json({ error: 'Email and profile are required.' });
    }

    const user = findUser(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const dailyCalories = calculateDailyCalories(profile);
    const version = getNextMenuVersion(email);
    const randomnessTag = Math.random().toString(36).slice(2);

    const prompt = `
You are a nutrition planner.

Create a weekly meal plan and shopping list for ONE person based on this profile:

- Goal: ${profile.goal}
- Age range: ${profile.ageRange}
- Gender: ${profile.gender}
- Height: ${profile.heightCm} cm
- Weight: ${profile.weightKg} kg
- Activity level: ${profile.activityLevel}
- Target daily calories: ${dailyCalories} kcal

This is MENU VERSION ${version} for this user.
Use the random token "${randomnessTag}" to introduce variety so each version is clearly different.

REQUIREMENTS:

1. Produce a plan for EXACTLY 7 days.
2. Each day has:
   - "dayIndex": number 1-7
   - "label": e.g. "Day 1" or weekday name
   - "meals": array of 3 meals: Breakfast, Lunch, Dinner.
     Each meal has:
       { "type": "Breakfast|Lunch|Dinner", "name": "string", "description": "string", "calories": number }
   - "shoppingItems": list of ingredients needed for that day only.
     Each item is:
       { "product": "string", "quantity": "string" }

3. Make meals realistic for a student (simple to cook, affordable) but healthy and aligned with the goal.

4. IMPORTANT: Return ONLY valid JSON, with this structure:

{
  "version": ${version},
  "days": [
    {
      "dayIndex": 1,
      "label": "Day 1",
      "meals": [
        {
          "type": "Breakfast",
          "name": "Oatmeal with berries",
          "description": "Short description here",
          "calories": 400
        },
        {
          "type": "Lunch",
          "name": "Example",
          "description": "Short description",
          "calories": 550
        },
        {
          "type": "Dinner",
          "name": "Example",
          "description": "Short description",
          "calories": 650
        }
      ],
      "shoppingItems": [
        { "product": "Oats", "quantity": "500 g" },
        { "product": "Milk", "quantity": "1 L" }
      ]
    }
  ]
}

Do not wrap JSON in markdown fences. Do not add extra fields.
`.trim();

    let days;
    let finalVersion = version;
    let warning;

    if (!ai) {
      throw new Error('AI client is not configured (missing GEMINI_API_KEY).');
    }

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt
      });

      const rawText = response.text;
      console.log('Gemini raw output (first 300 chars):');
      console.log(String(rawText || '').slice(0, 300));

      const parsed = extractJsonFromText(String(rawText || ''));

      if (!parsed || !Array.isArray(parsed.days)) {
        throw new Error('Parsed JSON has no "days" array.');
      }

      days = parsed.days;
      if (typeof parsed.version === 'number') {
        finalVersion = parsed.version;
      }
    } catch (aiErr) {
      console.error('AI error, using fallback menu:', aiErr);

      warning =
        'Using fallback menu because Gemini API request failed. Check your GEMINI_API_KEY, model name and quota.';

      days = [
        {
          dayIndex: 1,
          label: 'Day 1',
          meals: [
            {
              type: 'Breakfast',
              name: 'Oatmeal with berries',
              description: 'Wholegrain oats with milk and frozen berries.',
              calories: 400
            },
            {
              type: 'Lunch',
              name: 'Grilled chicken salad',
              description: 'Chicken breast with mixed salad and olive oil.',
              calories: 550
            },
            {
              type: 'Dinner',
              name: 'Salmon with vegetables',
              description: 'Baked salmon with broccoli and potatoes.',
              calories: 650
            }
          ],
          shoppingItems: [
            { product: 'Oats', quantity: '500 g' },
            { product: 'Milk', quantity: '1 L' },
            { product: 'Chicken breast', quantity: '300 g' },
            { product: 'Mixed salad', quantity: '1 pack' },
            { product: 'Salmon fillet', quantity: '300 g' },
            { product: 'Broccoli', quantity: '400 g' }
          ]
        },
        {
          dayIndex: 2,
          label: 'Day 2',
          meals: [
            {
              type: 'Breakfast',
              name: 'Greek yogurt with granola',
              description: 'Low-fat yogurt with granola and banana.',
              calories: 400
            },
            {
              type: 'Lunch',
              name: 'Turkey wrap with veggies',
              description: 'Tortilla wrap with turkey and vegetables.',
              calories: 550
            },
            {
              type: 'Dinner',
              name: 'Stir-fried tofu with rice',
              description: 'Tofu with vegetables and brown rice.',
              calories: 650
            }
          ],
          shoppingItems: [
            { product: 'Greek yogurt', quantity: '500 g' },
            { product: 'Granola', quantity: '200 g' },
            { product: 'Banana', quantity: '3 pcs' },
            { product: 'Turkey slices', quantity: '200 g' },
            { product: 'Tortillas', quantity: '4 pcs' },
            { product: 'Tofu', quantity: '200 g' },
            { product: 'Brown rice', quantity: '500 g' }
          ]
        }
      ];
    }

    const menu = {
      email,
      version: finalVersion,
      dailyCalories,
      days,
      generatedAt: Date.now()
    };
    if (warning) menu.warning = warning;

    saveMenu(menu);

    // Send the menu to the user's registration email (do NOT block the API response)
    if (mailer) {
      sendMenuEmail(email, menu)
        .then(() => console.log(`📧 Menu email sent to ${email}`))
        .catch((mailErr) => console.error('Email send failed:', mailErr));
    }

    // We don't send email back to shrink payload
    const { email: _ignored, ...clientMenu } = menu;
    res.json(clientMenu);
  } catch (err) {
    console.error('Unexpected menu generation error:', err);
    res.status(500).json({ error: 'Server error generating weekly menu.' });
  }
});

// ---------------- START SERVER ----------------

app.listen(PORT, () => {
  console.log(`✅ Server with DB + Gemini listening on http://localhost:${PORT}`);
});
