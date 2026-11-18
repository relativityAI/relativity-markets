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

<p align="center">
  <video src="assets/relativity-demo.mp4" controls muted playsinline width="100%">
    <a href="assets/relativity-demo.mp4">Watch the Relativity demo</a>
  </video>
</p>

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install](#install)
3. [Usage](#usage)
4. [Top contributors:](#top-contributors)
5. [License](#license)



## Prerequisites

- **Git** — required
- **Docker** — required (app + web search run on it)
- **Windows:** [Git Bash](https://git-scm.com/download/win)

## Install

```bash
git clone https://github.com/relativityAI/relativity-markets.git && cd relativity-markets && bash install.sh
```

**First visit**

No sign-up. Local user created automatically. Open **Settings** → paste LLM API keys (OpenAI, Gemini, Anthropic, ...). Encrypted, stored locally in `services/data/relativity.db`.

## Usage

```bash
relativity
```

Opens http://127.0.0.1:8501. Stop: `Ctrl+C`. Every run pulls the latest app image, so you always get the newest version — no `git pull` needed.

- Windows: install via Git Bash. Works in cmd, PowerShell, Git Bash.
- Closing the terminal leaves it running → stop with `docker compose down`
- Dev mode: `npm install && npm run dev` → http://localhost:5173

Pages:

- **`/new-analysis`** — start an analysis run
- **`/analysis-list`** — saved runs
- **`/agents`** — investor agents
- **`/my-workspace`** — agent library, skills, builder, tools
- **`/settings`** — API keys (encrypted)

CLI (from `services/`, needs `npm run searxng` + `OPENCODE_API_KEY`):

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
