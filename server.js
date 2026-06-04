const express = require("express");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
console.log("API Key loaded:", ANTHROPIC_API_KEY ? "✅ Yes" : "❌ Missing");

let db, goalsCollection, checkinsCollection;

async function connectDB() {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db("doitcoach");
  goalsCollection = db.collection("goals");
  checkinsCollection = db.collection("checkins");
  console.log("MongoDB connected ✅");
}

async function getSystemPrompt() {
  const goals = await goalsCollection.find().toArray();
  const checkins = await checkinsCollection
    .find().sort({ _id: -1 }).limit(5).toArray();

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

// the tools Claude can call
const tools = [
  {
    name: "save_goal",
    description: "Save a new goal the user wants to achieve. Call this when the user clearly states a goal or something they want to work toward consistently.",
    input_schema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "The goal exactly as the user described it"
        }
      },
      required: ["goal"]
    }
  }
];

// run the tool Claude decided to call
async function runTool(toolName, toolInput) {
  if (toolName === "save_goal") {
    await goalsCollection.insertOne({
      goal: toolInput.goal,
      createdAt: new Date()
    });
    console.log(`Goal saved via tool: ${toolInput.goal}`);
    return `Goal saved: "${toolInput.goal}"`;
  }
  return "Tool not found";
}

// call Claude API (non-streaming) and return full response
async function callClaude(messages) {
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
      system: await getSystemPrompt(),
      messages,
      tools
    })
  });
  return await response.json();
}

// Chat endpoint
app.post("/chat", async (req, res) => {
  const { messages } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let currentMessages = [...messages];
    let finalReply = "";

    // agentic loop — keeps going until Claude stops calling tools
    while (true) {
      const data = await callClaude(currentMessages);

      // check if Claude wants to call a tool
      const toolUseBlock = data.content.find(b => b.type === "tool_use");

      if (toolUseBlock) {
        // Claude decided to call a tool
        console.log(`Tool called: ${toolUseBlock.name}`, toolUseBlock.input);

        // YOU run the tool
        const toolResult = await runTool(toolUseBlock.name, toolUseBlock.input);

        // notify frontend a goal was saved
        if (toolUseBlock.name === "save_goal") {
          res.write(`data: ${JSON.stringify({ goalSaved: toolUseBlock.input.goal })}\n\n`);
        }

        // add Claude's tool_use + your tool_result to messages
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

        // loop again — Claude will now reply to user
        continue;
      }

      // no tool call — Claude is replying with text
      const textBlock = data.content.find(b => b.type === "text");
      if (textBlock) {
        finalReply = textBlock.text;
        // stream it word by word so UI still feels live
        const words = finalReply.split(" ");
        for (const word of words) {
          res.write(`data: ${JSON.stringify({ token: word + " " })}\n\n`);
          await new Promise(r => setTimeout(r, 30));
        }
      }
      break;
    }

    // save checkin
    const lastUserMsg = messages[messages.length - 1].content;
    await checkinsCollection.insertOne({
      entry: `[${new Date().toLocaleDateString()}] User: ${lastUserMsg} | Coach: ${finalReply.slice(0, 80)}...`,
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

// Save goals endpoint (still works for the + Add Goal button)
app.post("/goals", async (req, res) => {
  await goalsCollection.deleteMany({});
  const goalDocs = req.body.goals.map(goal => ({
    goal,
    createdAt: new Date()
  }));
  if (goalDocs.length > 0) {
    await goalsCollection.insertMany(goalDocs);
  }
  res.json({ success: true });
});

// Get goals endpoint
app.get("/goals", async (req, res) => {
  const goals = await goalsCollection.find().toArray();
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
