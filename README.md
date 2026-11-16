<a id="readme-top"></a>

<p align="center">
  <img src="assets/header.svg" alt="Relativity — Agents watch the market, you watch the agents." width="100%">
</p>

<h3 align="center">Create custom Agents to analyze, track, monitor the stock market</h3>

<div align="center">

  [![Tweet](https://img.shields.io/twitter/url/https/shields.io.svg?style=social)](https://twitter.com/intent/tweet?text=%F0%9F%93%A2%20Create%20custom%20Agents%20to%20analyze%2C%20track%2C%20monitor%20the%20stock%20market&url=https://github.com/relativityAI/relativity-markets)
  [![Status](https://img.shields.io/badge/status-active-success.svg)]()
  [![GitHub Issues](https://img.shields.io/github/issues/relativityAI/relativity-markets.svg)](https://github.com/relativityAI/relativity-markets/issues)
  [![GitHub Pull Requests](https://img.shields.io/github/issues-pr/relativityAI/relativity-markets.svg)](https://github.com/relativityAI/relativity-markets/pulls)
  [![License](https://img.shields.io/badge/license-UNLICENSED-blue.svg)](https://github.com/relativityAI/relativity-markets/blob/main/LICENSE)

</div>

<div align="center">
  Built by <a href="https://github.com/avishkarArjan/"><img src="https://github.com/avishkarArjan.png" alt="avishkarArjan" width="28" style="border-radius: 50%"></a>
</div>

---

## Table of Contents

1. [Installation](#installation)
2. [Usage](#usage)
3. [Top contributors:](#top-contributors)
4. [License](#license)



## Installation

**Option 1 — Docker** ([get Docker](https://docs.docker.com/get-docker/))

```bash
git clone https://github.com/relativityAI/relativity-markets.git
cd relativity-markets
docker compose up -d
```

Open http://localhost:8080. Web search is included and runs automatically. Stop with `docker compose down`.

**Option 2 — From source** (needs [Node.js](https://nodejs.org) 22.13+)

```bash
git clone https://github.com/relativityAI/relativity-markets.git
cd relativity-markets
npm install
npm run dev
```

Open http://localhost:5173. Stop with Ctrl+C. Optional web search needs Docker: `cd services && npm run searxng`.

**Option 3 — One command, no clone**

```bash
curl -fsSL https://raw.githubusercontent.com/relativityAI/relativity-markets/main/install.sh | sh
```

Uses Docker if you have it (same as Option 1), otherwise downloads the source and starts it (same as Option 2).

**First visit**

There's no sign-up — a local default user is created automatically. Go to **Settings** and paste your LLM API keys (OpenAI, Gemini, Anthropic, and others). They are stored encrypted on your machine. All your data lives in one file (`services/data/relativity.db`) — nothing is sent to a cloud.

## Usage

Run the tool:

- **Docker:** `docker compose up -d` → open http://localhost:8080
- **From source:** `npm run dev` → open http://localhost:5173

(see [Installation](#installation) for the full setup)

**First visit:** open **Settings** and paste your LLM API keys — the tool won't run without one.

Then in the web app:

- **`/new-analysis`** — Pick a source, company, skill, and model, then run an analysis.
- **`/analysis-list`** — Browse saved analysis runs.
- **`/agents`** — View and manage your investor agents.
- **`/my-workspace`** — My Workspace: agent library, skills, builder, and tools.
- **`/settings`** — Store LLM and Voyager API keys, encrypted at rest server-side.

Or run the CLI directly (from `services/`, with `npm run searxng` up and an `OPENCODE_API_KEY` set):

```bash
npm run cli -- --symbol AAPL --model opencode/deepseek-v4.1-flash --max-steps 20 --skill chartist-technical-analysis
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Top contributors:

<a href="https://github.com/relativityAI/relativity-markets/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=relativityAI/relativity-markets" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## License

Distributed under the UNLICENSED license. All rights reserved.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
