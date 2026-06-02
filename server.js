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
  return `You are DoIt, a personal accountability coach.
You are warm but direct. You never let excuses slide unchallenged.
You celebrate wins with genuine enthusiasm.
You always remember the user's goals and refer back to them.

RESPONSE RULES:
- Maximum 3 lines per reply
- No bullet points or bold text
- Always end with a question or a direct challenge
- Never open with "I" or "Great!"
- "Never use asterisks or markdown formatting"

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
${userGoals.length > 0 ? userGoals.map((g, i) => `${i+1}. ${g}`).join("\n") : "Not set yet. Ask them what they want to achieve."}

RECENT CHECK-INS:
${checkInHistory.length > 0 ? checkInHistory.slice(-5).join("\n") : "No check-ins yet."}`;
}

// Chat endpoint
app.post("/chat", async (req, res) => {
  const { messages } = req.body;

  // 1. SSE headers — keeps connection open
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system: getSystemPrompt(),
        messages: messages,
        stream: true,            // 2. Tell Claude to stream
      }),
    });

    let fullReply = "";

    // 3. Read the stream chunk by chunk
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter(line => line.startsWith("data:"));

      for (const line of lines) {
        const jsonStr = line.replace("data: ", "").trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === "content_block_delta") {
            const token = parsed.delta.text;
            fullReply += token;
            // 4. Send each token to the browser immediately
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch (_) {}
      }
    }

    // 5. Save check-in history (same as before, just moved here)
    const lastUserMsg = messages[messages.length - 1].content;
    checkInHistory.push(
      `[${new Date().toLocaleDateString()}] User: ${lastUserMsg} | Coach: ${fullReply.slice(0, 80)}...`
    );

    // 6. Signal stream is done
    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (err) {
    console.error("Full error:", err);
    res.write(`data: ${JSON.stringify({ error: "Something went wrong." })}\n\n`);
    res.end();
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
