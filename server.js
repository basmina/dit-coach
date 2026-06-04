const express = require("express");
const { MongoClient } = require("mongodb");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

// session middleware
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// passport middleware
app.use(passport.initialize());
app.use(passport.session());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
console.log("API Key loaded:", ANTHROPIC_API_KEY ? "✅ Yes" : "❌ Missing");

let db, goalsCollection, checkinsCollection, usersCollection;
// TEMP: test reminder endpoint — remove after testing
app.get("/test-reminder", async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    const today = new Date().toLocaleDateString();
    let sent = 0;

    for (const user of users) {
      const goals = await goalsCollection
        .find({ userId: user.googleId }).toArray();

      if (goals.length === 0) continue;

      const goalList = goals.map((g, i) => `${i+1}. ${g.goal}`).join("\n");

      await transporter.sendMail({
        from: `"DoIt Coach" <${process.env.GMAIL_ID}>`,
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

      console.log(`Reminder sent to ${user.email}`);
      sent++;
    }

    res.json({ success: true, emailsSent: sent });
  } catch (err) {
    console.error(err);
    res.json({ error: err.message });
  }
});
async function connectDB() {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db("doitcoach");
  goalsCollection = db.collection("goals");
  checkinsCollection = db.collection("checkins");
  usersCollection = db.collection("users");
  console.log("MongoDB connected ✅");
}

// email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_ID,
    pass: process.env.GMAIL_PASSWORD
  }
});

// daily reminder — runs every day at 8pm IST (14:30 UTC)
cron.schedule("30 14 * * *", async () => {
  console.log("Running daily reminder check...");
  try {
    const users = await usersCollection.find({}).toArray();
    const today = new Date().toLocaleDateString();

    for (const user of users) {
      // check if user has checked in today
      const todayCheckin = await checkinsCollection.findOne({
        userId: user.googleId,
        entry: { $regex: today }
      });

      if (!todayCheckin) {
        // no checkin today — get their goals
        const goals = await goalsCollection
          .find({ userId: user.googleId }).toArray();

        if (goals.length === 0) continue; // skip users with no goals

        const goalList = goals.map((g, i) => `${i+1}. ${g.goal}`).join("\n");

        await transporter.sendMail({
          from: `"DoIt Coach" <${process.env.GMAIL_ID}>`,
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

        console.log(`Reminder sent to ${user.email}`);
      }
    }
  } catch (err) {
    console.error("Reminder error:", err);
  }
});
// Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "https://dit-coach.onrender.com/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // find or create user in MongoDB
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

passport.serializeUser((user, done) => {
  done(null, user.googleId);
});

passport.deserializeUser(async (googleId, done) => {
  try {
    const user = await usersCollection.findOne({ googleId });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// auth routes
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/");
  }
);

app.get("/auth/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

app.get("/auth/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: { name: req.user.name, email: req.user.email, photo: req.user.photo } });
  } else {
    res.json({ user: null });
  }
});

// middleware to protect routes
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
    await goalsCollection.insertOne({
      goal: toolInput.goal,
      userId,
      createdAt: new Date()
    });
    console.log(`Goal saved for user ${userId}: ${toolInput.goal}`);
    return `Goal saved: "${toolInput.goal}"`;
  }
  return "Tool not found";
}

async function callClaude(messages, userId) {
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
      tools
    })
  });
  return await response.json();
}

// Chat endpoint — protected
app.post("/chat", requireAuth, async (req, res) => {
  const { messages } = req.body;
  const userId = req.user.googleId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let currentMessages = [...messages];
    let finalReply = "";

    while (true) {
      const data = await callClaude(currentMessages, userId);
      const toolUseBlock = data.content.find(b => b.type === "tool_use");

      if (toolUseBlock) {
        const toolResult = await runTool(toolUseBlock.name, toolUseBlock.input, userId);

        if (toolUseBlock.name === "save_goal") {
          res.write(`data: ${JSON.stringify({ goalSaved: toolUseBlock.input.goal })}\n\n`);
        }

        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: data.content },
          {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: toolUseBlock.id,
              content: toolResult
            }]
          }
        ];
        continue;
      }

      const textBlock = data.content.find(b => b.type === "text");
      if (textBlock) {
        finalReply = textBlock.text;
        const words = finalReply.split(" ");
        for (const word of words) {
          res.write(`data: ${JSON.stringify({ token: word + " " })}\n\n`);
          await new Promise(r => setTimeout(r, 30));
        }
      }
      break;
    }

    const lastUserMsg = messages[messages.length - 1].content;
    await checkinsCollection.insertOne({
      entry: `[${new Date().toLocaleDateString()}] User: ${lastUserMsg} | Coach: ${finalReply.slice(0, 80)}...`,
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

// Goals endpoints — protected
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

connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`DoIt Coach running on port ${PORT}`);
  });
}).catch(err => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});
