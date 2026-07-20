const express = require("express");
const { MongoClient } = require("mongodb");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { Resend } = require("resend");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    dbName: "doitcoach",
    collectionName: "sessions"
  }),
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const resend = new Resend(process.env.RESEND_API_KEY);
console.log("API Key loaded:", ANTHROPIC_API_KEY ? "✅ Yes" : "❌ Missing");

let db, goalsCollection, checkinsCollection, usersCollection, messagesCollection;

async function connectDB() {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db("doitcoach");
  goalsCollection = db.collection("goals");
  checkinsCollection = db.collection("checkins");
  usersCollection = db.collection("users");
  messagesCollection = db.collection("messages");
  // one document per user, holding their full running message array
  await messagesCollection.createIndex({ userId: 1 }, { unique: true });
  console.log("MongoDB connected ✅");
}

async function getHistory(userId) {
  const doc = await messagesCollection.findOne({ userId });
  return doc ? doc.messages : [];
}

async function appendToHistory(userId, newMessages) {
  await messagesCollection.updateOne(
    { userId },
    { $push: { messages: { $each: newMessages } }, $setOnInsert: { userId } },
    { upsert: true }
  );
}

async function sendReminderEmail(user, goalList) {
  await resend.emails.send({
    from: "DoIt Coach <onboarding@resend.dev>",
    to: user.email,
    subject: "DoIt Coach — daily check-in 👋",
    text: `Hey ${user.name.split(" ")[0]},

You haven't checked in today. Your coach is waiting.

Your goals:
${goalList}

How did it go? Come back and tell your coach:
https://dit-coach.onrender.com

— DoIt Coach`
  });
}

// daily reminder — 8pm IST = 14:30 UTC
cron.schedule("30 14 * * *", async () => {
  console.log("Running daily reminder check...");
  try {
    const users = await usersCollection.find({}).toArray();
    const today = new Date().toLocaleDateString();

    for (const user of users) {
      const todayCheckin = await checkinsCollection.findOne({
        userId: user.googleId,
        entry: { $regex: today }
      });

      if (!todayCheckin) {
        const goals = await goalsCollection
          .find({ userId: user.googleId }).toArray();
        if (goals.length === 0) continue;

        const goalList = goals.map((g, i) => `${i+1}. ${g.goal}`).join("\n");
        await sendReminderEmail(user, goalList);
        console.log(`Reminder sent to ${user.email}`);
      }
    }
  } catch (err) {
    console.error("Reminder error:", err);
  }
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "https://dit-coach.onrender.com/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await usersCollection.findOne({ googleId: profile.id });
    if (!user) {
      const result = await usersCollection.insertOne({
        googleId: profile.id,
        name: profile.displayName,
        email: profile.emails[0].value,
        photo: profile.photos[0].value,
        createdAt: new Date()
      });
      user = { _id: result.insertedId, googleId: profile.id, name: profile.displayName, email: profile.emails[0].value };
    }
    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.googleId));

passport.deserializeUser(async (googleId, done) => {
  try {
    const user = await usersCollection.findOne({ googleId });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => res.redirect("/")
);

app.get("/auth/logout", (req, res) => {
  req.logout(() => res.redirect("/"));
});

app.get("/auth/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: { name: req.user.name, email: req.user.email, photo: req.user.photo } });
  } else {
    res.json({ user: null });
  }
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Please log in" });
}

async function getSystemPrompt(userId) {
  const goals = await goalsCollection.find({ userId }).toArray();
  const checkins = await checkinsCollection
    .find({ userId }).sort({ _id: -1 }).limit(5).toArray();

  return `You are DoIt, a personal accountability coach.
You are warm but direct. You never let excuses slide unchallenged.
You celebrate wins with genuine enthusiasm.
You always remember the user's goals and refer back to them.

RESPONSE RULES:
- Maximum 3 lines per reply
- No bullet points or bold text
- Always end with a question or a direct challenge
- Never open with "I" or "Great!"
- Never use asterisks or markdown formatting

EXAMPLES:
User: "I didn't go to the gym today"
Coach: "What got in the way?
You had it in the plan. Time, energy, or just didn't feel like it?"

User: "I finished the report I've been avoiding!"
Coach: "YES. That's the one.
Two weeks of resistance — one session to kill it.
What made today different?"

User: "I'll start tomorrow"
Coach: "You said that yesterday.
What's one thing you can do in the next 10 minutes?"

USER GOALS:
${goals.length > 0 ? goals.map((g, i) => `${i+1}. ${g.goal}`).join("\n") : "Not set yet. Ask them what they want to achieve."}

RECENT CHECK-INS:
${checkins.length > 0 ? checkins.map(c => c.entry).reverse().join("\n") : "No check-ins yet."}`;
}

const tools = [
  {
    name: "save_goal",
    description: "Save a new goal ONLY when the user explicitly states a specific habit or goal they want to commit to long-term. Do NOT call this for general conversation, check-ins, or updates about existing goals. Only call when the user is setting a NEW goal for the first time.",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The goal exactly as the user described it" }
      },
      required: ["goal"]
    }
  }
];

async function runTool(toolName, toolInput, userId) {
  if (toolName === "save_goal") {
    await goalsCollection.insertOne({ goal: toolInput.goal, userId, createdAt: new Date() });
    console.log(`Goal saved for user ${userId}: ${toolInput.goal}`);
    return `Goal saved: "${toolInput.goal}"`;
  }
  return "Tool not found";
}

// Streams real Claude output via SSE. Returns the assistant's finished
// content blocks (text + any tool_use) once the stream completes, so the
// caller can decide whether to loop again for a tool_result turn.
async function streamClaudeTurn(messages, userId, res) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      system: await getSystemPrompt(userId),
      messages,
      tools,
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Content blocks assembled as they stream in, indexed by their position.
  const blocks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop();

    for (const evt of events) {
      const line = evt.split("\n").find(l => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.replace("data:", "").trim();
      if (!payload) continue;

      let msg;
      try { msg = JSON.parse(payload); } catch { continue; }

      if (msg.type === "content_block_start") {
        blocks[msg.index] = msg.content_block.type === "tool_use"
          ? { type: "tool_use", id: msg.content_block.id, name: msg.content_block.name, inputJson: "" }
          : { type: "text", text: "" };
      }

      if (msg.type === "content_block_delta") {
        const block = blocks[msg.index];
        if (msg.delta.type === "text_delta") {
          block.text += msg.delta.text;
          // real token-by-token forwarding to the client, no artificial delay
          res.write(`data: ${JSON.stringify({ token: msg.delta.text })}\n\n`);
        } else if (msg.delta.type === "input_json_delta") {
          block.inputJson += msg.delta.partial_json;
        }
      }
    }
  }

  // finalize tool_use inputs from accumulated JSON
  return blocks.map(b => {
    if (b.type === "tool_use") {
      return { type: "tool_use", id: b.id, name: b.name, input: JSON.parse(b.inputJson || "{}") };
    }
    return { type: "text", text: b.text };
  });
}

const MAX_TOOL_ITERATIONS = 5;

app.post("/chat", requireAuth, async (req, res) => {
  const { message } = req.body; // client now sends only the new user turn
  const userId = req.user.googleId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const history = await getHistory(userId);
    const userTurn = { role: "user", content: message };
    let currentMessages = [...history, userTurn];
    let finalReply = "";
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const contentBlocks = await streamClaudeTurn(currentMessages, userId, res);
      const toolUseBlock = contentBlocks.find(b => b.type === "tool_use");

      if (toolUseBlock) {
        const toolResult = await runTool(toolUseBlock.name, toolUseBlock.input, userId);
        if (toolUseBlock.name === "save_goal") {
          res.write(`data: ${JSON.stringify({ goalSaved: toolUseBlock.input.goal })}\n\n`);
        }
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: contentBlocks },
          { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseBlock.id, content: toolResult }] }
        ];
        continue;
      }

      const textBlock = contentBlocks.find(b => b.type === "text");
      finalReply = textBlock ? textBlock.text : "";
      // persist the full turn (user message + final assistant reply) once we're done
      await appendToHistory(userId, [userTurn, { role: "assistant", content: finalReply }]);
      break;
    }

    if (iterations >= MAX_TOOL_ITERATIONS && !finalReply) {
      finalReply = "Sorry, I got stuck processing that. Try rephrasing?";
      res.write(`data: ${JSON.stringify({ token: finalReply })}\n\n`);
      await appendToHistory(userId, [userTurn, { role: "assistant", content: finalReply }]);
    }

    await checkinsCollection.insertOne({
      entry: `[${new Date().toLocaleDateString()}] User: ${message} | Coach: ${finalReply.slice(0, 80)}...`,
      userId,
      createdAt: new Date()
    });

    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (err) {
    console.error("Full error:", err);
    res.write(`data: ${JSON.stringify({ error: "Something went wrong." })}\n\n`);
    res.end();
  }
});

// lets the frontend rehydrate the chat window on page load / refresh
app.get("/chat/history", requireAuth, async (req, res) => {
  const history = await getHistory(req.user.googleId);
  res.json({ messages: history });
});

app.post("/goals", requireAuth, async (req, res) => {
  const userId = req.user.googleId;
  await goalsCollection.deleteMany({ userId });
  const goalDocs = req.body.goals.map(goal => ({ goal, userId, createdAt: new Date() }));
  if (goalDocs.length > 0) await goalsCollection.insertMany(goalDocs);
  res.json({ success: true });
});

app.get("/goals", requireAuth, async (req, res) => {
  const userId = req.user.googleId;
  const goals = await goalsCollection.find({ userId }).toArray();
  res.json({ goals: goals.map(g => g.goal) });
});

// test reminder endpoint — remove after testing
app.get("/test-reminder", async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    let sent = 0;

    for (const user of users) {
      const goals = await goalsCollection.find({ userId: user.googleId }).toArray();
      if (goals.length === 0) continue;

      const goalList = goals.map((g, i) => `${i+1}. ${g.goal}`).join("\n");
      await sendReminderEmail(user, goalList);
      console.log(`Reminder sent to ${user.email}`);
      sent++;
    }
    res.json({ success: true, emailsSent: sent });
  } catch (err) {
    console.error(err);
    res.json({ error: err.message });
  }
});

connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`DoIt Coach running on port ${PORT}`));
}).catch(err => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});