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
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/relativityAI/relativity-markets/blob/main/LICENSE)

</div>

<div align="center">
  Built by <a href="https://github.com/avishkarArjan/"><img src="https://github.com/avishkarArjan.png" alt="avishkarArjan" width="28" style="border-radius: 50%"></a>
</div>

---

<p align="center">
  <img src="assets/homepage_screenshot.png" alt="Relativity homepage screenshot" width="100%">
</p>

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install](#install)
3. [Usage](#usage)
4. [Cleanup](#cleanup)
5. [Architecture](#architecture)
6. [Top contributors:](#top-contributors)
7. [License](#license)



## Prerequisites

- **Git** — required
- **Docker** — required (app + web search run on it). On Linux, `install.sh` installs Docker, Compose and `curl` via the system package manager if they are missing (sudo required). Set `RELATIVITY_SKIP_PACKAGE_INSTALL=1` to opt out.
- **Windows:** [Git Bash](https://git-scm.com/download/win)

## Install

```bash
git clone https://github.com/relativityAI/relativity-markets.git && cd relativity-markets && bash install.sh
```

`install.sh` is the single entry point: it detects the platform and delegates to `scripts/install-linux.sh` (Linux/macOS) or `scripts/install-windows.sh` (Windows/Git Bash). Shared logic lives in `scripts/install-common.sh`.

Re-running `install.sh` is safe — it skips packages and PATH setup that are already in place.

**First visit**

No sign-up. Local user created automatically. Open **Settings** → paste LLM API keys (OpenAI, Gemini, Anthropic, ...). Encrypted, stored locally in `services/data/relativity.db`.

## Usage

```bash
relativity
```

Opens http://127.0.0.1:8501. Stop: `Ctrl+C`. Every run pulls the latest app image, so you always get the newest version — no `git pull` needed.

- Windows: install via Git Bash. Works in cmd, PowerShell, Git Bash.
- Closing the terminal (or Ctrl+C) stops the containers — nothing left running.
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

## Cleanup

```bash
bash cleanup.sh
```

Like `install.sh`, this is a single entry point that delegates to `scripts/cleanup-linux.sh` or `scripts/cleanup-windows.sh`. It removes only the `relativity` command, the PATH entries the installer added, this checkout's Docker containers, and the two images this project owns. Local data (`services/data`), system packages, Docker volumes, third-party images and other projects are left untouched.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## Architecture

<p align="center">
  <img src="assets/relativity-markets-runtime-dark.svg" alt="Relativity Markets runtime architecture: operator browser (React + Vite SPA) → API server (Express REST + SSE, loopback :8501) → run orchestrator → agent engine (deepagents + LangGraph), with LLM providers, SQLite store, toolbox client (streamable HTTP MCP), and run workspace." width="100%">
</p>

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Top contributors:

<a href="https://github.com/relativityAI/relativity-markets/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=relativityAI/relativity-markets" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
