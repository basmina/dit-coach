# ⚡ DoIt Coach — AI Accountability Agent

> *You know what you should do. DoIt makes sure you actually do it.*

DoIt is a conversational AI accountability coach built on the Anthropic Claude API. Unlike passive to-do apps and reminders, DoIt **talks back** — it checks in on your goals, pushes against weak excuses, and celebrates real progress.

🌐 **Live demo:** [dit-coach.onrender.com](https://dit-coach.onrender.com/)

---

## 🎯 The Problem

Most people don't fail their goals for lack of knowledge. They fail for lack of accountability.

To-do apps are passive. Reminders are easy to ignore. What actually works is a coach that asks *"did you do it today?"* and doesn't accept weak answers.

That's DoIt.

---

## ✨ Features

- 💬 **Conversational coaching** — talk to your coach in natural language, like texting a friend
- 🎯 **Goal tracking** — set up to 3 active goals; the coach references them in every check-in
- 🔥 **Excuse challenger** — when you make excuses, the coach pushes back instead of letting you off
- 🏆 **Win recognition** — genuine encouragement when you follow through
- 🧠 **Conversation memory** — the coach remembers prior turns and builds on what you said
- 📱 **Responsive UI** — clean chat interface that works on desktop and mobile

---

## 🏗️ Architecture

```
┌──────────────┐      POST /chat       ┌─────────────────┐      Claude API       ┌──────────────┐
│  Chat UI     │ ────────────────────▶ │  Express        │ ────────────────────▶ │  Anthropic   │
│  (HTML/JS)   │ ◀──────────────────── │  server.js      │ ◀──────────────────── │  Claude      │
└──────────────┘    coach response     └─────────────────┘    completion          └──────────────┘
       │                                       │
       │                                       │
       └────  goals + conversation  ───────────┘
              history sent each turn
                   (stateless server)
```

- **Server is stateless.** The frontend keeps the full conversation history and sends it on every request, so any instance of the server can handle any user without shared state.
- **Coaching behavior** lives entirely in the system prompt — tone, excuse-challenging logic, and win-recognition framing. No fine-tuning, no vector DB.
- **Secrets** are managed through environment variables (`.env` locally, Render env vars in production).

---

## 🛠️ Built With

| Layer    | Tech |
|----------|------|
| Backend  | Node.js, Express.js |
| AI       | Anthropic Claude API (`@anthropic-ai/sdk`) |
| Frontend | HTML, CSS, vanilla JavaScript |
| Hosting  | Render |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- An Anthropic API key → [console.anthropic.com](https://console.anthropic.com)

### Installation

```bash
# Clone the repo
git clone https://github.com/basmina/dit-coach.git
cd dit-coach

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Then open .env and paste your Anthropic API key

# Run the app
node server.js
```

Open **<http://localhost:3000>** in your browser.

### Environment Variables

| Variable             | Required | Description                                                |
|----------------------|----------|------------------------------------------------------------|
| `ANTHROPIC_API_KEY`  | Yes      | Your Anthropic API key from console.anthropic.com          |
| `PORT`               | No       | Server port (defaults to 3000)                             |

---

## 📸 Screenshot

> ![DOIT](image.png)

---


## 💡 How to Use

1. **Add a goal** — type something you've been putting off and click **+ Add Goal**
2. **Start talking** — tell the coach how it's going
3. **Be honest** — the coach works best when you're real with it
4. **Check in daily** — consistency is the whole point

---

## 🗺️ Roadmap

Ideas being considered:

- Persistent storage for goals and chat history across sessions
- Daily push/email check-ins (currently pull-based)
- Streak tracking and weekly summaries
- Voice input for hands-free check-ins

---

## 📄 License

MIT — free to use, fork, and build on.

---

*Built by [Basmina](https://github.com/basmina) — exploring how conversational AI can change the accountability problem from a notification problem into a relationship problem.*
