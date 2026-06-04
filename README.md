# ⚡ DoIt Coach — AI Accountability Agent

> *You know what you should do. DoIt makes sure you actually do it.*

DoIt is a conversational AI accountability coach built on the Anthropic Claude API. Unlike passive to-do apps, DoIt **talks back** — it challenges excuses, celebrates wins, saves your goals automatically, and sends you a daily reminder if you haven't checked in.

🌐 **Live demo:** [dit-coach.onrender.com](https://dit-coach.onrender.com/)  
💻 **Code:** [github.com/basmina/dit-coach](https://github.com/basmina/dit-coach)

---

## 🎯 The Problem

Most people don't fail their goals for lack of knowledge. They fail for lack of accountability.

To-do apps are passive. Reminders are easy to ignore. What actually works is a coach that asks *"did you do it today?"* — and doesn't accept weak answers.

That's DoIt.

---

## ✨ Features

- 💬 **Conversational coaching** — talk in natural language, like texting a strict-but-caring friend
- 🔐 **Google OAuth login** — secure sign-in, every user's data is private and isolated
- 🎯 **Agentic goal saving** — mention a goal in chat and Claude automatically saves it via function calling — no buttons needed
- 🧠 **Persistent memory** — goals and check-in history stored in MongoDB, survive server restarts
- 🔥 **Excuse challenger** — the coach pushes back instead of letting you off the hook
- 🏆 **Win recognition** — genuine enthusiasm when you follow through
- 📨 **Daily reminder emails** — if you haven't checked in by 8pm, DoIt sends you a nudge via Resend
- ⚡ **Live streaming responses** — token-by-token delivery via Server-Sent Events (SSE)

---

## 🏗️ Architecture

```
┌──────────────┐    POST /chat     ┌─────────────────┐    Claude API    ┌──────────────┐
│  Chat UI     │ ────────────────▶ │  Express        │ ───────────────▶ │  Anthropic   │
│  (HTML/JS)   │ ◀──────────────── │  server.js      │ ◀─────────────── │  Claude      │
└──────────────┘   SSE stream      └─────────────────┘   tool_use /     └──────────────┘
       │                                  │               text response
       │                           ┌──────┴───────┐
       │                           │   MongoDB     │
       └── goals loaded on login ──│   Atlas       │
                                   │   goals       │
                                   │   checkins    │
                                   │   users       │
                                   └───────────────┘
```

### Key design decisions

- **Agentic tool calling** — Claude decides when to save a goal via the `save_goal` tool. The model reads the conversation and calls the tool at the right moment. No form submit needed.
- **Stateless server** — the frontend sends the full conversation history each turn. Any server instance can handle any request.
- **Coaching behavior via prompt engineering** — tone, excuse-challenging logic, response format, and few-shot examples are defined entirely in the system prompt. No fine-tuning or vector DB required.
- **SSE simulated streaming** — Claude API called without `stream: true` to support tool calling; the server simulates streaming by forwarding the response word-by-word with a 30ms delay.

---

## 🛠️ Built With

| Layer | Tech |
|---|---|
| Backend | Node.js, Express.js |
| AI | Anthropic Claude API, function calling, system prompt engineering |
| Auth | Google OAuth 2.0 via Passport.js |
| Database | MongoDB Atlas |
| Email | Resend API |
| Scheduler | node-cron |
| Frontend | HTML, CSS, vanilla JavaScript |
| Hosting | Render |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Anthropic API key → [console.anthropic.com](https://console.anthropic.com)
- MongoDB Atlas connection string → [cloud.mongodb.com](https://cloud.mongodb.com)
- Google OAuth credentials → [console.cloud.google.com](https://console.cloud.google.com)
- Resend API key → [resend.com](https://resend.com)

### Installation

```bash
git clone https://github.com/basmina/dit-coach.git
cd dit-coach
npm install
cp .env.example .env
# Fill in your environment variables
node server.js
```

Open **http://localhost:3000**

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `SESSION_SECRET` | Yes | Random string for session encryption |
| `RESEND_API_KEY` | Yes | Resend API key for reminder emails |
| `PORT` | No | Server port (defaults to 3000) |

---

## 💡 How It Works

1. **Sign in with Google** — your data is private and isolated to your account
2. **Tell the coach your goal** — just say it in chat, Claude saves it automatically
3. **Check in daily** — tell the coach how it went, it will push back if needed
4. **Get a nudge** — if you forget, DoIt emails you at 8pm with your goals listed

---

## 📸 Screenshot

<img width="1884" height="948" alt="image" src="https://github.com/user-attachments/assets/0ea6add8-9641-435e-813c-4a8d4100efe8" />


---

## 🗺️ What's Next

- Streak tracking and weekly progress summaries
- Voice input for hands-free check-ins
- RAG-powered pattern recognition ("you've said this 4 times in 3 months")
- MCP server to expose coaching tools to other AI agents

---

## 📄 License

MIT — free to use, fork, and build on.

---

*Built by [Basmina](https://github.com/basmina) — exploring how conversational AI and agentic patterns can turn accountability from a notification problem into a relationship problem.*
