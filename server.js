const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
console.log("API Key loaded:", ANTHROPIC_API_KEY ? "✅ Yes" : "❌ Missing");

// Store goals and history in memory
let userGoals = [];
let checkInHistory = [];

// System prompt for the coach
function getSystemPrompt() {
  return `You are DoIt, a personal accountability coach. You are warm but direct and honest.
You never let users make excuses without gently challenging them.
You celebrate wins enthusiastically.
You ask "why" when someone isn't doing what they said they would.
You remember the user's goals and refer to them often.

The user's current goals are:
${userGoals.length > 0 ? userGoals.map((g, i) => `${i + 1}. ${g}`).join("\n") : "Not set yet. Ask them what they want to achieve."}

Recent check-in history:
${checkInHistory.length > 0 ? checkInHistory.slice(-5).join("\n") : "No check-ins yet."}

Keep responses short, punchy, and conversational — like a coach texting you.
Never write long paragraphs. Use line breaks. Be human.`;
}

// Chat endpoint
app.post("/chat", async (req, res) => {
  const { messages } = req.body;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: getSystemPrompt(),
        messages: messages,
      }),
    });

    const data = await response.json();
    console.log("API response:", JSON.stringify(data, null, 2));

    if (data.error) {
      return res.status(500).json({ reply: `API Error: ${data.error.message}` });
    }

    if (!data.content || !data.content[0]) {
      return res.status(500).json({ reply: "No response from API. Check terminal for details." });
    }

    const reply = data.content[0].text;

    // Auto-save check-in summary
    const lastUserMsg = messages[messages.length - 1].content;
    checkInHistory.push(`[${new Date().toLocaleDateString()}] User: ${lastUserMsg} | Coach: ${reply.slice(0, 80)}...`);

    res.json({ reply });
  } catch (err) {
    console.error("Full error:", err);
    res.status(500).json({ reply: "Something went wrong. Check your terminal." });
  }
});

// Save goals endpoint
app.post("/goals", (req, res) => {
  userGoals = req.body.goals;
  res.json({ success: true });
});

// Get goals endpoint
app.get("/goals", (req, res) => {
  res.json({ goals: userGoals });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DoIt Coach running on port ${PORT}`);
});