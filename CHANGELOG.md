# Changelog

## [0.12.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.11.0...relativity-markets-v0.12.0) (2026-11-22)


### Features

* **settings:** AI Providers table + custom OpenAI-compatible providers ([#200](https://github.com/relativityAI/relativity-markets/issues/200)) ([be3fcdb](https://github.com/relativityAI/relativity-markets/commit/be3fcdbe7b64bf1e157390806b17647c19d59641))

## [0.11.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.10.0...relativity-markets-v0.11.0) (2026-11-19)


### Features

* replace scheduled runs with an alert system ([#193](https://github.com/relativityAI/relativity-markets/issues/193)) ([767b0f1](https://github.com/relativityAI/relativity-markets/commit/767b0f19093e0089b5c62275c36fcb534f1343ed))

## [0.10.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.9.0...relativity-markets-v0.10.0) (2026-11-19)


### Features

* remove Chakra, UX audit fixes, opencode provider, workspace reorg ([#191](https://github.com/relativityAI/relativity-markets/issues/191)) ([af91d85](https://github.com/relativityAI/relativity-markets/commit/af91d85aedff8db6221645b5098aeea01ee4f65e))

## [0.9.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.8.1...relativity-markets-v0.9.0) (2026-11-18)


### Features

* two-column home, runs insights, lighter console type ([#186](https://github.com/relativityAI/relativity-markets/issues/186)) ([2df4d74](https://github.com/relativityAI/relativity-markets/commit/2df4d7419045720cd18a091f074005543ce8611e))

## [0.8.1](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.8.0...relativity-markets-v0.8.1) (2026-11-17)


### Bug Fixes

* **cli:** always run the latest image, on every platform ([1d4376e](https://github.com/relativityAI/relativity-markets/commit/1d4376e2e93d549ec7dd6c8156cb4dd7a0a747e5))

## [0.8.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.7.0...relativity-markets-v0.8.0) (2026-11-17)


### Features

* MCP toolbox, key-aware models, and watchlist polish ([#172](https://github.com/relativityAI/relativity-markets/issues/172)) ([3d829c4](https://github.com/relativityAI/relativity-markets/commit/3d829c40e1a3346baea68a5bd4a0c253909ba702))

## [0.7.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.6.2...relativity-markets-v0.7.0) (2026-11-17)


### Features

* **harness:** agent toolbox moves to yfinance MCP; drop Voyager REST ([#168](https://github.com/relativityAI/relativity-markets/issues/168)) ([1d7cefb](https://github.com/relativityAI/relativity-markets/commit/1d7cefb9d0ceea827cb5cac48fc2c038ee78edda))

## [0.6.2](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.6.1...relativity-markets-v0.6.2) (2026-11-16)


### Performance Improvements

* instant relativity start + native-platform docker builds ([#166](https://github.com/relativityAI/relativity-markets/issues/166)) ([0189ff6](https://github.com/relativityAI/relativity-markets/commit/0189ff66a552b7fe2c5d7284138ff280ad3728d4))

## [0.6.1](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.6.0...relativity-markets-v0.6.1) (2026-11-16)


### Bug Fixes

* **ci:** release step needs GH_REPO — job has no checkout for gh to discover ([#164](https://github.com/relativityAI/relativity-markets/issues/164)) ([58da291](https://github.com/relativityAI/relativity-markets/commit/58da291ecb0c75320f57080104034f83437b7f63))

## [0.6.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.5.0...relativity-markets-v0.6.0) (2026-11-16)


### Features

* **cli:** relativity one-command launcher + docker-mandatory install (+ release workflow fix) ([#161](https://github.com/relativityAI/relativity-markets/issues/161)) ([41a8849](https://github.com/relativityAI/relativity-markets/commit/41a8849bbbb5314df7457ace6959069a06e44219))

## [0.5.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.4.0...relativity-markets-v0.5.0) (2026-11-16)


### Features

* agent categories, schedules + DeepAgents harness & final plot reference ([#159](https://github.com/relativityAI/relativity-markets/issues/159)) ([d9df052](https://github.com/relativityAI/relativity-markets/commit/d9df0525b6e37694aa2503ec8a184f5b4557d424))

## [0.4.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.3.1...relativity-markets-v0.4.0) (2026-11-16)


### Features

* **agents:** one category per agent, schedule frequencies, category-gated runs ([#157](https://github.com/relativityAI/relativity-markets/issues/157)) ([580fb34](https://github.com/relativityAI/relativity-markets/commit/580fb347a7c5d0aa26e6a8a78c42c5aaa3edd648))

## [0.3.1](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.3.0...relativity-markets-v0.3.1) (2026-11-15)


### Bug Fixes

* **docker:** share the local-first SQLite file instead of a per-project volume ([#155](https://github.com/relativityAI/relativity-markets/issues/155)) ([2e5e7ca](https://github.com/relativityAI/relativity-markets/commit/2e5e7caee44f0c89313ba387b5a76f1dae574ea4))

## [0.3.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.2.0...relativity-markets-v0.3.0) (2026-11-15)


### Features

* one-command install — prebuilt GHCR image, npm workspaces, install.sh ([#153](https://github.com/relativityAI/relativity-markets/issues/153)) ([3e46ec2](https://github.com/relativityAI/relativity-markets/commit/3e46ec2c92185090feed5707e9d1ebb78053622b))

## [0.2.0](https://github.com/relativityAI/relativity-markets/compare/relativity-markets-v0.1.0...relativity-markets-v0.2.0) (2026-11-15)


### Features

* add OpenRouter provider and free Groq/OpenRouter models ([#17](https://github.com/relativityAI/relativity-markets/issues/17)) ([80301ec](https://github.com/relativityAI/relativity-markets/commit/80301ec9262e63495a88b6f8c32b7a2154da15af))
* add Supabase auth (email + Google) with per-user data scoping ([#20](https://github.com/relativityAI/relativity-markets/issues/20)) ([3845d6d](https://github.com/relativityAI/relativity-markets/commit/3845d6d10d4fc18d90526ad0d58d3d6ee2f45132))
* **agents:** one skill per agent; single Agents & Skills workspace page ([26c0e86](https://github.com/relativityAI/relativity-markets/commit/26c0e869828aed8f3415cd7bff07e01cc297bc92))
* analysis pipeline reliability, branded PDF report, reasoning tab ([#57](https://github.com/relativityAI/relativity-markets/issues/57)) ([f3bb88a](https://github.com/relativityAI/relativity-markets/commit/f3bb88aacaa630a4583b2c9abc80a8d76e6e3972))
* **api:** canvas pass-through for full sections ([e5ca8ee](https://github.com/relativityAI/relativity-markets/commit/e5ca8eef75c5d7ec153bbb9e10a76651ac1d935f))
* **api:** feed workspace payloads into attachChartData ([fbef663](https://github.com/relativityAI/relativity-markets/commit/fbef663c5c446dd9651527acfc88e0ec591a5942))
* **api:** pipeline — wire attachChartData, drop footnote rewriting ([4c7b606](https://github.com/relativityAI/relativity-markets/commit/4c7b6064a4cefea131bfef88ca3e5c4b53abb456))
* **api:** prompts — full-section write contract in AGENTS.md ([aa67f5b](https://github.com/relativityAI/relativity-markets/commit/aa67f5bc32ccb7eb46ee04f4c59e07fcfededf3c))
* **api:** report schema v2 — nested full sections ([d341cbb](https://github.com/relativityAI/relativity-markets/commit/d341cbb1b45041ce10f97c91be57341bcd9f3f8b))
* **api:** run config passthrough, default agent, persist verdict & duration ([cc5bfa5](https://github.com/relativityAI/relativity-markets/commit/cc5bfa549e6dccd6c92477928382b031a08fad95))
* **api:** scheduled runs + agent-run launch endpoints ([4ce87d6](https://github.com/relativityAI/relativity-markets/commit/4ce87d6611e224a5f47f2bd1d061ea4d90779a3e))
* **api:** section contract — BLOCKS catalog + full-section prompt shape ([40b310f](https://github.com/relativityAI/relativity-markets/commit/40b310f117aa6595f713a56a64dcdab95367df28))
* **api:** v2 consumers — dump, PDF, API alias, template checks ([e734e18](https://github.com/relativityAI/relativity-markets/commit/e734e185f06ee1ead7fc1d89787627ea6c0c9ea4))
* **api:** wire harness into server; delete layout pipeline ([0e73636](https://github.com/relativityAI/relativity-markets/commit/0e73636f925a90a0a88c1c4aa5d9bf89f37ed25f))
* **api:** yahoo data tool, report/figure updates, yahoo symbol helper ([85b2a93](https://github.com/relativityAI/relativity-markets/commit/85b2a93c17de2d966693d83dedf30da572b360ee))
* auto-provision user_settings on first authenticated request ([#24](https://github.com/relativityAI/relativity-markets/issues/24)) ([dd15e47](https://github.com/relativityAI/relativity-markets/commit/dd15e4799fcd6dba9f1b5c9b0dc742f61c0176e5))
* auto-provision Voyager key on login with retry logic, remove manual key UI ([#28](https://github.com/relativityAI/relativity-markets/issues/28)) ([c2a96d5](https://github.com/relativityAI/relativity-markets/commit/c2a96d5085ba8c30abcecd815b708bdc83f21072))
* builder live web search, activity trace, and cited decisions ([#34](https://github.com/relativityAI/relativity-markets/issues/34)) ([5f8bc19](https://github.com/relativityAI/relativity-markets/commit/5f8bc19d60848302a4202b61be70c8443275e469))
* drop strategy/risk config from agent schema — philosophy + skills only ([#85](https://github.com/relativityAI/relativity-markets/issues/85)) ([db60d26](https://github.com/relativityAI/relativity-markets/commit/db60d26a4c0d5cda588723dc61fc749a80d4f595))
* dynamic model notes, builder typing UX, seed default agents ([#54](https://github.com/relativityAI/relativity-markets/issues/54)) ([0ddd998](https://github.com/relativityAI/relativity-markets/commit/0ddd998259dd269593065bad9d42ac6ff3229e90))
* expose Voyager advanced data suite to the agent as tools ([#55](https://github.com/relativityAI/relativity-markets/issues/55)) ([3cd96f4](https://github.com/relativityAI/relativity-markets/commit/3cd96f4ffd2bd7afef5122a6c6409aec1f7b315e))
* full migration to Supabase Postgres, Google-only auth, per-user encrypted API keys ([#22](https://github.com/relativityAI/relativity-markets/issues/22)) ([053abc6](https://github.com/relativityAI/relativity-markets/commit/053abc6fff97dfdcc35dd6c365bdc85570dd6ce8))
* **harness:** agent harness v2 runtime — typed ReportDocument, canvas, workspace, CLI ([0e4326b](https://github.com/relativityAI/relativity-markets/commit/0e4326b7d17eff1d7e9b37572bcdd355d26cceb6))
* **harness:** named system prompts — choose one per run by name ([760205b](https://github.com/relativityAI/relativity-markets/commit/760205b57ece2ae3830a3616b15c143c277c2006))
* **harness:** v2 plan engine + prompts module behind one runAnalysis seam ([8b16c10](https://github.com/relativityAI/relativity-markets/commit/8b16c101fab6b2a81fff98cf37691902939753bc))
* integrate Framer Motion app-wide and rework key page layouts ([#31](https://github.com/relativityAI/relativity-markets/issues/31)) ([74a4f2c](https://github.com/relativityAI/relativity-markets/commit/74a4f2c3142e2b53e3ddae3c4764337b54750540))
* iterative-only analysis pipeline, document section tools, report authoring & nav updates ([#99](https://github.com/relativityAI/relativity-markets/issues/99)) ([ac252b9](https://github.com/relativityAI/relativity-markets/commit/ac252b9ae93a12fd831107a2f1f4df7452592fcc))
* **layout:** extract manifest contract, refs grounding, report verification & chart axis polish ([#97](https://github.com/relativityAI/relativity-markets/issues/97)) ([2fcad6d](https://github.com/relativityAI/relativity-markets/commit/2fcad6d136e94c72f61f78d312b72246ca03a8be))
* **layout:** inline metric grids for scalar figures, section-paired viz ([#96](https://github.com/relativityAI/relativity-markets/issues/96)) ([7e103b5](https://github.com/relativityAI/relativity-markets/commit/7e103b52bca5de65bfe5edae6143d00a014aafeb))
* **layout:** OpenUI layout agent for interactive result reports ([#95](https://github.com/relativityAI/relativity-markets/issues/95)) ([8a20544](https://github.com/relativityAI/relativity-markets/commit/8a205447cb69c8108dc6397e3bd9f03fcce6fdf1))
* local-first SQLite storage with schema migrations; UI updates ([#146](https://github.com/relativityAI/relativity-markets/issues/146)) ([d49c77b](https://github.com/relativityAI/relativity-markets/commit/d49c77b7b7b3c79ffb36b2f15ae6122cadfe922d))
* market-independent agents, honest scoring, markdown-first agent store, and major UX passes ([#63](https://github.com/relativityAI/relativity-markets/issues/63)) ([473219f](https://github.com/relativityAI/relativity-markets/commit/473219ff5b13a29dbede87e07eedbe6180b40c14))
* new minimalist brand identity across app and PDF reports ([#74](https://github.com/relativityAI/relativity-markets/issues/74)) ([2f214b1](https://github.com/relativityAI/relativity-markets/commit/2f214b1ab165f41658f381b2a1590aa9ad0e6de8))
* on-demand stock data pull with freshness checks ([#29](https://github.com/relativityAI/relativity-markets/issues/29)) ([e79e4c8](https://github.com/relativityAI/relativity-markets/commit/e79e4c8284cd9bd0bf3704935dd2f9ef82a73e59))
* PDF pagination — section/chapter page breaks, UI parity, card styling ([#86](https://github.com/relativityAI/relativity-markets/issues/86)) ([9b9215f](https://github.com/relativityAI/relativity-markets/commit/9b9215fe3a44793db5087e860f3bc7052516677d))
* pooled LLM key farm, quota-aware default model, usage dashboard ([#62](https://github.com/relativityAI/relativity-markets/issues/62)) ([#62](https://github.com/relativityAI/relativity-markets/issues/62)) ([566ddac](https://github.com/relativityAI/relativity-markets/commit/566ddac373b7a2c86e8954bd92c43bbe6d6dea3c))
* real Voyager integrations, surgical builder edits, detailed change UI ([22c9159](https://github.com/relativityAI/relativity-markets/commit/22c915964bb3dc4c51d67634a5483ca6eb3e887a))
* redesign landing hero with screenshot panel and animated headline ([#39](https://github.com/relativityAI/relativity-markets/issues/39)) ([4adc53e](https://github.com/relativityAI/relativity-markets/commit/4adc53e6a35d915ee2037f0c101e79482db95e87))
* reliability and UX enhancements ([#35](https://github.com/relativityAI/relativity-markets/issues/35)) ([4bbeeb7](https://github.com/relativityAI/relativity-markets/commit/4bbeeb7780a18ef07c4fc347794e60216518c62e))
* **report:** trim section contract; agent-named series; hover readout on line charts ([eae544d](https://github.com/relativityAI/relativity-markets/commit/eae544ddcf96b3a61d787baa0c40c6de4dedf177))
* **runs:** persist chosen system prompt + skills; show both in Past Runs ([06f9df6](https://github.com/relativityAI/relativity-markets/commit/06f9df649f0926fd95fa270cfa7e9467804e2612))
* SearXNG web search, OpenCode provider, model curation ([6aae71f](https://github.com/relativityAI/relativity-markets/commit/6aae71fc809fd9abf04e608748d5b3c103d9264d))
* show real data-source logos on landing marquee, analysis, and results ([#61](https://github.com/relativityAI/relativity-markets/issues/61)) ([85221f8](https://github.com/relativityAI/relativity-markets/commit/85221f88b5cc7093b9ae9f28bcee492d6bafbbb1))
* simplify agent config — Market removed, risk appetite 1-10 slider, Horizon+Risk only, quant gate removed, metrics auto-loaded, schema-synced ([#32](https://github.com/relativityAI/relativity-markets/issues/32)) ([3b008a0](https://github.com/relativityAI/relativity-markets/commit/3b008a0c96704da0663e9a57ef3df1a1b203330b))
* simplify skill runs and aggregate agent scores ([#83](https://github.com/relativityAI/relativity-markets/issues/83)) ([6e0fa82](https://github.com/relativityAI/relativity-markets/commit/6e0fa8214f8fca31a540a5b30a24f9fb9cce89d5))
* single-skill evaluation runs, skill avatars, and non-destructive report finalization ([#82](https://github.com/relativityAI/relativity-markets/issues/82)) ([1a2f75c](https://github.com/relativityAI/relativity-markets/commit/1a2f75c47ca5f9ec777ade6164222ed725dd8d58))
* **skills:** frontmatter tags for search and display ([fbab46e](https://github.com/relativityAI/relativity-markets/commit/fbab46ed22a4544eb04d4ed48622d18cadc02595))
* **skills:** navigable skill workspace — file tree editor for view and create ([f82d05c](https://github.com/relativityAI/relativity-markets/commit/f82d05c31cfe8151a45911fe653f1585f85fe5fc))
* **skills:** tools frontmatter on SKILL.md; drop legacy analysis skills ([df45dab](https://github.com/relativityAI/relativity-markets/commit/df45dabce19a1312491dd6dbe1d9039ca49b63e0))
* smooth all UI state transitions with motion ([#38](https://github.com/relativityAI/relativity-markets/issues/38)) ([#38](https://github.com/relativityAI/relativity-markets/issues/38)) ([b4de256](https://github.com/relativityAI/relativity-markets/commit/b4de25664de3ab613b1cc0adf03bd2c0d40697f5))
* standalone iterative analysis agent + expanded chart catalog ([#98](https://github.com/relativityAI/relativity-markets/issues/98)) ([fbe033b](https://github.com/relativityAI/relativity-markets/commit/fbe033bc517083aedff2a4f2541f3319a4a5de58))
* trace streaming + reasoning tab + PageHero grid inset fix ([#53](https://github.com/relativityAI/relativity-markets/issues/53)) ([fb1698e](https://github.com/relativityAI/relativity-markets/commit/fb1698efd0da233f1c1434cfb2a7774cec8a59c6))
* **ui:** fold workspace nav into NavBar; report prose column ([af26422](https://github.com/relativityAI/relativity-markets/commit/af26422306ef14f3e8ead50eafb52abc7fc236a4))
* **ui:** homepage sectoral agents + shared agent card ([37e07ed](https://github.com/relativityAI/relativity-markets/commit/37e07eda287d5370262c4b53384e8375d295d0e9))
* **ui:** masthead, square editorial console, HomePage ([8d375ab](https://github.com/relativityAI/relativity-markets/commit/8d375ab34da4fa617960398e3f3ac971fefc3d07))
* **ui:** my-workspace shell — nav, landing removal, PageTOC & WorkspaceNav ([fd84b2c](https://github.com/relativityAI/relativity-markets/commit/fd84b2cb514d7768cb22c784a153546e8965d489))
* **ui:** navbar data-source chips with live SearXNG/Yahoo probes ([4031150](https://github.com/relativityAI/relativity-markets/commit/4031150838ae03d1b2081e3869e88bc3fc0f99bf))
* **ui:** new-run page mirrors harness CLI flags ([89400c7](https://github.com/relativityAI/relativity-markets/commit/89400c723e4a850e57eb174ef1422c6a5e3379d3))
* **ui:** redesign landing page — real result hero, preset showcase, cookie banner removal ([#72](https://github.com/relativityAI/relativity-markets/issues/72)) ([b44ae06](https://github.com/relativityAI/relativity-markets/commit/b44ae06202d008a172542a317c7329fa9611c11b))
* **ui:** report renderer and harness run views ([83dfbfa](https://github.com/relativityAI/relativity-markets/commit/83dfbfa9bb3eae843d37789bafad944d9397551e))
* **ui:** stack new-run config rows with progress rail; skills as dropdown ([2b6fc32](https://github.com/relativityAI/relativity-markets/commit/2b6fc3200e3f2bffa496bafd25bc27469adbab15))
* **ui:** stock page with agent cell, skill tags editor ([3e773b5](https://github.com/relativityAI/relativity-markets/commit/3e773b537c2b06d7a4936f1f6572387263cfa828))
* **ui:** swap analysis-list insight plots for SVG bar charts ([1fdd886](https://github.com/relativityAI/relativity-markets/commit/1fdd8862bc371acc7dcac1e0ece06113c0f4c332))
* **ui:** v2 report contract + nested-section render path ([3815bf6](https://github.com/relativityAI/relativity-markets/commit/3815bf62858bae920f45fce601242ce2ce87b5fe))
* **ui:** wire stock page, skill tags, and workspace polish ([a4f00e4](https://github.com/relativityAI/relativity-markets/commit/a4f00e4a99085184c3056be507af8e969fd2d097))
* **ui:** workspace-first result flow; past-runs verdict, duration, ctrl-click ([293edcc](https://github.com/relativityAI/relativity-markets/commit/293edccd9b23ea9a0d7577cb64c200c369116cee))
* unify buttons to surface/subtle variants, add trend hover tooltips, SPA fallback, and preset refresh ([#40](https://github.com/relativityAI/relativity-markets/issues/40)) ([9fb8874](https://github.com/relativityAI/relativity-markets/commit/9fb8874611c64f2c88477fc9b19fb8007f09c6db))
* v2 scoring pipeline (rubric, judge, KB) + analysis result UX overhaul ([#67](https://github.com/relativityAI/relativity-markets/issues/67)) ([ca22d6f](https://github.com/relativityAI/relativity-markets/commit/ca22d6fbb4a1a455f1095f18b6167e34787c0833))
* v3 skills pipeline — retry-hardened analysis, per-tool provenance, lightweight-charts plots ([#81](https://github.com/relativityAI/relativity-markets/issues/81)) ([18aa827](https://github.com/relativityAI/relativity-markets/commit/18aa82716626f4cc7e9f6c1116184ce002150049))
* verdict-led result redesign, GitHub skill import, report plots ([#93](https://github.com/relativityAI/relativity-markets/issues/93)) ([1072aa2](https://github.com/relativityAI/relativity-markets/commit/1072aa22de34165f17da6aefbe39c3710000dea0))


### Bug Fixes

* **api:** agent skills only, structure once, never clear state digests ([587d49a](https://github.com/relativityAI/relativity-markets/commit/587d49aae94e314d9d3db9baa3f42d48f87f46c5))
* backfill Voyager key when user_settings row exists but key is missing ([#25](https://github.com/relativityAI/relativity-markets/issues/25)) ([39461f0](https://github.com/relativityAI/relativity-markets/commit/39461f0d22b69dcf9501c7be4951ad6b07e6cf89))
* bounce logged-in users home from /index.html and unknown paths ([#37](https://github.com/relativityAI/relativity-markets/issues/37)) ([2f2b6df](https://github.com/relativityAI/relativity-markets/commit/2f2b6dfa4d90037dc2448f6300e9483eae87d15f))
* default agents never persisted (missing user_id); re-seed safely + respect deletes ([#59](https://github.com/relativityAI/relativity-markets/issues/59)) ([39b2c2f](https://github.com/relativityAI/relativity-markets/commit/39b2c2f10ac25eb007e86d61122eac411c08b42f))
* enable quantitative params in builder and manual editor ([#33](https://github.com/relativityAI/relativity-markets/issues/33)) ([ec57cc9](https://github.com/relativityAI/relativity-markets/commit/ec57cc93797b4fcf0582dfec44cc1e5f3e59b908))
* enable Voyager data pulls for SEC symbols ([#69](https://github.com/relativityAI/relativity-markets/issues/69)) ([6fcf748](https://github.com/relativityAI/relativity-markets/commit/6fcf748dab580ac933352c2391cc05ba8083933b))
* match Voyager admin API spec exactly (owner, rpm, expires_in_days required) ([#27](https://github.com/relativityAI/relativity-markets/issues/27)) ([8236961](https://github.com/relativityAI/relativity-markets/commit/8236961312ea7282e9e72a031c7b9f147615e07c))
* **release:** match release-please tag names; allow manual publish for existing tags ([#147](https://github.com/relativityAI/relativity-markets/issues/147)) ([dcf533b](https://github.com/relativityAI/relativity-markets/commit/dcf533b4bd2fa99d5a5a3b112fdf653cf412605b))
* **release:** zip asset path — file is created inside client/ ([#150](https://github.com/relativityAI/relativity-markets/issues/150)) ([939d5f6](https://github.com/relativityAI/relativity-markets/commit/939d5f6ecf16a8943cd64540d1d833979b69cf1a))
* **report:** candle charts, volume bars, dump-time figure rendering ([bffc449](https://github.com/relativityAI/relativity-markets/commit/bffc4492118faab120eed83b83737f3b03e1c412))
* restore api artifacts modules unblocking Render build ([#91](https://github.com/relativityAI/relativity-markets/issues/91)) ([1adcdaa](https://github.com/relativityAI/relativity-markets/commit/1adcdaabc989eeb6e70e857bf9c7c131aa043a52))
* send POST /pull params as query string (Voyager expects query params) ([#70](https://github.com/relativityAI/relativity-markets/issues/70)) ([6a11df1](https://github.com/relativityAI/relativity-markets/commit/6a11df1c5d2e5ab3b5a7d54c43f1bb0161f8e447))
* strip _id from agent update payload, default source to NSE ([#23](https://github.com/relativityAI/relativity-markets/issues/23)) ([f4c27cf](https://github.com/relativityAI/relativity-markets/commit/f4c27cfef72fe49e6d334b29c2ccb2fac9ae6fe1))
* track src/lib so Render build can resolve motion and supabase ([#36](https://github.com/relativityAI/relativity-markets/issues/36)) ([fa5d4ef](https://github.com/relativityAI/relativity-markets/commit/fa5d4ef641cb780935c0e6fe50b719cb7accdfe8))
* update model list to current provider models ([#21](https://github.com/relativityAI/relativity-markets/issues/21)) ([90908df](https://github.com/relativityAI/relativity-markets/commit/90908dffb7db35dfd4b4e1c686d1c7d9539d8f1a))
* use correct Voyager admin API format (X-Voyager-Admin-Key header, name + scopes in body) ([#26](https://github.com/relativityAI/relativity-markets/issues/26)) ([f9c6bbc](https://github.com/relativityAI/relativity-markets/commit/f9c6bbc0fd980d7bc88c30ccbe3cd6a55fa0f035))

## 0.1.0 (2026-11-15)


### Features

* add OpenRouter provider and free Groq/OpenRouter models ([#17](https://github.com/relativityAI/relativity-markets/issues/17)) ([80301ec](https://github.com/relativityAI/relativity-markets/commit/80301ec9262e63495a88b6f8c32b7a2154da15af))
* add Supabase auth (email + Google) with per-user data scoping ([#20](https://github.com/relativityAI/relativity-markets/issues/20)) ([3845d6d](https://github.com/relativityAI/relativity-markets/commit/3845d6d10d4fc18d90526ad0d58d3d6ee2f45132))
* **agents:** one skill per agent; single Agents & Skills workspace page ([26c0e86](https://github.com/relativityAI/relativity-markets/commit/26c0e869828aed8f3415cd7bff07e01cc297bc92))
* analysis pipeline reliability, branded PDF report, reasoning tab ([#57](https://github.com/relativityAI/relativity-markets/issues/57)) ([f3bb88a](https://github.com/relativityAI/relativity-markets/commit/f3bb88aacaa630a4583b2c9abc80a8d76e6e3972))
* **api:** canvas pass-through for full sections ([e5ca8ee](https://github.com/relativityAI/relativity-markets/commit/e5ca8eef75c5d7ec153bbb9e10a76651ac1d935f))
* **api:** feed workspace payloads into attachChartData ([fbef663](https://github.com/relativityAI/relativity-markets/commit/fbef663c5c446dd9651527acfc88e0ec591a5942))
* **api:** pipeline — wire attachChartData, drop footnote rewriting ([4c7b606](https://github.com/relativityAI/relativity-markets/commit/4c7b6064a4cefea131bfef88ca3e5c4b53abb456))
* **api:** prompts — full-section write contract in AGENTS.md ([aa67f5b](https://github.com/relativityAI/relativity-markets/commit/aa67f5bc32ccb7eb46ee04f4c59e07fcfededf3c))
* **api:** report schema v2 — nested full sections ([d341cbb](https://github.com/relativityAI/relativity-markets/commit/d341cbb1b45041ce10f97c91be57341bcd9f3f8b))
* **api:** run config passthrough, default agent, persist verdict & duration ([cc5bfa5](https://github.com/relativityAI/relativity-markets/commit/cc5bfa549e6dccd6c92477928382b031a08fad95))
* **api:** scheduled runs + agent-run launch endpoints ([4ce87d6](https://github.com/relativityAI/relativity-markets/commit/4ce87d6611e224a5f47f2bd1d061ea4d90779a3e))
* **api:** section contract — BLOCKS catalog + full-section prompt shape ([40b310f](https://github.com/relativityAI/relativity-markets/commit/40b310f117aa6595f713a56a64dcdab95367df28))
* **api:** v2 consumers — dump, PDF, API alias, template checks ([e734e18](https://github.com/relativityAI/relativity-markets/commit/e734e185f06ee1ead7fc1d89787627ea6c0c9ea4))
* **api:** wire harness into server; delete layout pipeline ([0e73636](https://github.com/relativityAI/relativity-markets/commit/0e73636f925a90a0a88c1c4aa5d9bf89f37ed25f))
* **api:** yahoo data tool, report/figure updates, yahoo symbol helper ([85b2a93](https://github.com/relativityAI/relativity-markets/commit/85b2a93c17de2d966693d83dedf30da572b360ee))
* auto-provision user_settings on first authenticated request ([#24](https://github.com/relativityAI/relativity-markets/issues/24)) ([dd15e47](https://github.com/relativityAI/relativity-markets/commit/dd15e4799fcd6dba9f1b5c9b0dc742f61c0176e5))
* auto-provision Voyager key on login with retry logic, remove manual key UI ([#28](https://github.com/relativityAI/relativity-markets/issues/28)) ([c2a96d5](https://github.com/relativityAI/relativity-markets/commit/c2a96d5085ba8c30abcecd815b708bdc83f21072))
* builder live web search, activity trace, and cited decisions ([#34](https://github.com/relativityAI/relativity-markets/issues/34)) ([5f8bc19](https://github.com/relativityAI/relativity-markets/commit/5f8bc19d60848302a4202b61be70c8443275e469))
* drop strategy/risk config from agent schema — philosophy + skills only ([#85](https://github.com/relativityAI/relativity-markets/issues/85)) ([db60d26](https://github.com/relativityAI/relativity-markets/commit/db60d26a4c0d5cda588723dc61fc749a80d4f595))
* dynamic model notes, builder typing UX, seed default agents ([#54](https://github.com/relativityAI/relativity-markets/issues/54)) ([0ddd998](https://github.com/relativityAI/relativity-markets/commit/0ddd998259dd269593065bad9d42ac6ff3229e90))
* expose Voyager advanced data suite to the agent as tools ([#55](https://github.com/relativityAI/relativity-markets/issues/55)) ([3cd96f4](https://github.com/relativityAI/relativity-markets/commit/3cd96f4ffd2bd7afef5122a6c6409aec1f7b315e))
* full migration to Supabase Postgres, Google-only auth, per-user encrypted API keys ([#22](https://github.com/relativityAI/relativity-markets/issues/22)) ([053abc6](https://github.com/relativityAI/relativity-markets/commit/053abc6fff97dfdcc35dd6c365bdc85570dd6ce8))
* **harness:** agent harness v2 runtime — typed ReportDocument, canvas, workspace, CLI ([0e4326b](https://github.com/relativityAI/relativity-markets/commit/0e4326b7d17eff1d7e9b37572bcdd355d26cceb6))
* **harness:** named system prompts — choose one per run by name ([760205b](https://github.com/relativityAI/relativity-markets/commit/760205b57ece2ae3830a3616b15c143c277c2006))
* **harness:** v2 plan engine + prompts module behind one runAnalysis seam ([8b16c10](https://github.com/relativityAI/relativity-markets/commit/8b16c101fab6b2a81fff98cf37691902939753bc))
* integrate Framer Motion app-wide and rework key page layouts ([#31](https://github.com/relativityAI/relativity-markets/issues/31)) ([74a4f2c](https://github.com/relativityAI/relativity-markets/commit/74a4f2c3142e2b53e3ddae3c4764337b54750540))
* iterative-only analysis pipeline, document section tools, report authoring & nav updates ([#99](https://github.com/relativityAI/relativity-markets/issues/99)) ([ac252b9](https://github.com/relativityAI/relativity-markets/commit/ac252b9ae93a12fd831107a2f1f4df7452592fcc))
* **layout:** extract manifest contract, refs grounding, report verification & chart axis polish ([#97](https://github.com/relativityAI/relativity-markets/issues/97)) ([2fcad6d](https://github.com/relativityAI/relativity-markets/commit/2fcad6d136e94c72f61f78d312b72246ca03a8be))
* **layout:** inline metric grids for scalar figures, section-paired viz ([#96](https://github.com/relativityAI/relativity-markets/issues/96)) ([7e103b5](https://github.com/relativityAI/relativity-markets/commit/7e103b52bca5de65bfe5edae6143d00a014aafeb))
* **layout:** OpenUI layout agent for interactive result reports ([#95](https://github.com/relativityAI/relativity-markets/issues/95)) ([8a20544](https://github.com/relativityAI/relativity-markets/commit/8a205447cb69c8108dc6397e3bd9f03fcce6fdf1))
* local-first SQLite storage with schema migrations; UI updates ([#146](https://github.com/relativityAI/relativity-markets/issues/146)) ([d49c77b](https://github.com/relativityAI/relativity-markets/commit/d49c77b7b7b3c79ffb36b2f15ae6122cadfe922d))
* market-independent agents, honest scoring, markdown-first agent store, and major UX passes ([#63](https://github.com/relativityAI/relativity-markets/issues/63)) ([473219f](https://github.com/relativityAI/relativity-markets/commit/473219ff5b13a29dbede87e07eedbe6180b40c14))
* new minimalist brand identity across app and PDF reports ([#74](https://github.com/relativityAI/relativity-markets/issues/74)) ([2f214b1](https://github.com/relativityAI/relativity-markets/commit/2f214b1ab165f41658f381b2a1590aa9ad0e6de8))
* on-demand stock data pull with freshness checks ([#29](https://github.com/relativityAI/relativity-markets/issues/29)) ([e79e4c8](https://github.com/relativityAI/relativity-markets/commit/e79e4c8284cd9bd0bf3704935dd2f9ef82a73e59))
* PDF pagination — section/chapter page breaks, UI parity, card styling ([#86](https://github.com/relativityAI/relativity-markets/issues/86)) ([9b9215f](https://github.com/relativityAI/relativity-markets/commit/9b9215fe3a44793db5087e860f3bc7052516677d))
* pooled LLM key farm, quota-aware default model, usage dashboard ([#62](https://github.com/relativityAI/relativity-markets/issues/62)) ([#62](https://github.com/relativityAI/relativity-markets/issues/62)) ([566ddac](https://github.com/relativityAI/relativity-markets/commit/566ddac373b7a2c86e8954bd92c43bbe6d6dea3c))
* real Voyager integrations, surgical builder edits, detailed change UI ([22c9159](https://github.com/relativityAI/relativity-markets/commit/22c915964bb3dc4c51d67634a5483ca6eb3e887a))
* redesign landing hero with screenshot panel and animated headline ([#39](https://github.com/relativityAI/relativity-markets/issues/39)) ([4adc53e](https://github.com/relativityAI/relativity-markets/commit/4adc53e6a35d915ee2037f0c101e79482db95e87))
* reliability and UX enhancements ([#35](https://github.com/relativityAI/relativity-markets/issues/35)) ([4bbeeb7](https://github.com/relativityAI/relativity-markets/commit/4bbeeb7780a18ef07c4fc347794e60216518c62e))
* **report:** trim section contract; agent-named series; hover readout on line charts ([eae544d](https://github.com/relativityAI/relativity-markets/commit/eae544ddcf96b3a61d787baa0c40c6de4dedf177))
* **runs:** persist chosen system prompt + skills; show both in Past Runs ([06f9df6](https://github.com/relativityAI/relativity-markets/commit/06f9df649f0926fd95fa270cfa7e9467804e2612))
* SearXNG web search, OpenCode provider, model curation ([6aae71f](https://github.com/relativityAI/relativity-markets/commit/6aae71fc809fd9abf04e608748d5b3c103d9264d))
* show real data-source logos on landing marquee, analysis, and results ([#61](https://github.com/relativityAI/relativity-markets/issues/61)) ([85221f8](https://github.com/relativityAI/relativity-markets/commit/85221f88b5cc7093b9ae9f28bcee492d6bafbbb1))
* simplify agent config — Market removed, risk appetite 1-10 slider, Horizon+Risk only, quant gate removed, metrics auto-loaded, schema-synced ([#32](https://github.com/relativityAI/relativity-markets/issues/32)) ([3b008a0](https://github.com/relativityAI/relativity-markets/commit/3b008a0c96704da0663e9a57ef3df1a1b203330b))
* simplify skill runs and aggregate agent scores ([#83](https://github.com/relativityAI/relativity-markets/issues/83)) ([6e0fa82](https://github.com/relativityAI/relativity-markets/commit/6e0fa8214f8fca31a540a5b30a24f9fb9cce89d5))
* single-skill evaluation runs, skill avatars, and non-destructive report finalization ([#82](https://github.com/relativityAI/relativity-markets/issues/82)) ([1a2f75c](https://github.com/relativityAI/relativity-markets/commit/1a2f75c47ca5f9ec777ade6164222ed725dd8d58))
* **skills:** frontmatter tags for search and display ([fbab46e](https://github.com/relativityAI/relativity-markets/commit/fbab46ed22a4544eb04d4ed48622d18cadc02595))
* **skills:** navigable skill workspace — file tree editor for view and create ([f82d05c](https://github.com/relativityAI/relativity-markets/commit/f82d05c31cfe8151a45911fe653f1585f85fe5fc))
* **skills:** tools frontmatter on SKILL.md; drop legacy analysis skills ([df45dab](https://github.com/relativityAI/relativity-markets/commit/df45dabce19a1312491dd6dbe1d9039ca49b63e0))
* smooth all UI state transitions with motion ([#38](https://github.com/relativityAI/relativity-markets/issues/38)) ([#38](https://github.com/relativityAI/relativity-markets/issues/38)) ([b4de256](https://github.com/relativityAI/relativity-markets/commit/b4de25664de3ab613b1cc0adf03bd2c0d40697f5))
* standalone iterative analysis agent + expanded chart catalog ([#98](https://github.com/relativityAI/relativity-markets/issues/98)) ([fbe033b](https://github.com/relativityAI/relativity-markets/commit/fbe033bc517083aedff2a4f2541f3319a4a5de58))
* trace streaming + reasoning tab + PageHero grid inset fix ([#53](https://github.com/relativityAI/relativity-markets/issues/53)) ([fb1698e](https://github.com/relativityAI/relativity-markets/commit/fb1698efd0da233f1c1434cfb2a7774cec8a59c6))
* **ui:** fold workspace nav into NavBar; report prose column ([af26422](https://github.com/relativityAI/relativity-markets/commit/af26422306ef14f3e8ead50eafb52abc7fc236a4))
* **ui:** homepage sectoral agents + shared agent card ([37e07ed](https://github.com/relativityAI/relativity-markets/commit/37e07eda287d5370262c4b53384e8375d295d0e9))
* **ui:** masthead, square editorial console, HomePage ([8d375ab](https://github.com/relativityAI/relativity-markets/commit/8d375ab34da4fa617960398e3f3ac971fefc3d07))
* **ui:** my-workspace shell — nav, landing removal, PageTOC & WorkspaceNav ([fd84b2c](https://github.com/relativityAI/relativity-markets/commit/fd84b2cb514d7768cb22c784a153546e8965d489))
* **ui:** navbar data-source chips with live SearXNG/Yahoo probes ([4031150](https://github.com/relativityAI/relativity-markets/commit/4031150838ae03d1b2081e3869e88bc3fc0f99bf))
* **ui:** new-run page mirrors harness CLI flags ([89400c7](https://github.com/relativityAI/relativity-markets/commit/89400c723e4a850e57eb174ef1422c6a5e3379d3))
* **ui:** redesign landing page — real result hero, preset showcase, cookie banner removal ([#72](https://github.com/relativityAI/relativity-markets/issues/72)) ([b44ae06](https://github.com/relativityAI/relativity-markets/commit/b44ae06202d008a172542a317c7329fa9611c11b))
* **ui:** report renderer and harness run views ([83dfbfa](https://github.com/relativityAI/relativity-markets/commit/83dfbfa9bb3eae843d37789bafad944d9397551e))
* **ui:** stack new-run config rows with progress rail; skills as dropdown ([2b6fc32](https://github.com/relativityAI/relativity-markets/commit/2b6fc3200e3f2bffa496bafd25bc27469adbab15))
* **ui:** stock page with agent cell, skill tags editor ([3e773b5](https://github.com/relativityAI/relativity-markets/commit/3e773b537c2b06d7a4936f1f6572387263cfa828))
* **ui:** swap analysis-list insight plots for SVG bar charts ([1fdd886](https://github.com/relativityAI/relativity-markets/commit/1fdd8862bc371acc7dcac1e0ece06113c0f4c332))
* **ui:** v2 report contract + nested-section render path ([3815bf6](https://github.com/relativityAI/relativity-markets/commit/3815bf62858bae920f45fce601242ce2ce87b5fe))
* **ui:** wire stock page, skill tags, and workspace polish ([a4f00e4](https://github.com/relativityAI/relativity-markets/commit/a4f00e4a99085184c3056be507af8e969fd2d097))
* **ui:** workspace-first result flow; past-runs verdict, duration, ctrl-click ([293edcc](https://github.com/relativityAI/relativity-markets/commit/293edccd9b23ea9a0d7577cb64c200c369116cee))
* unify buttons to surface/subtle variants, add trend hover tooltips, SPA fallback, and preset refresh ([#40](https://github.com/relativityAI/relativity-markets/issues/40)) ([9fb8874](https://github.com/relativityAI/relativity-markets/commit/9fb8874611c64f2c88477fc9b19fb8007f09c6db))
* v2 scoring pipeline (rubric, judge, KB) + analysis result UX overhaul ([#67](https://github.com/relativityAI/relativity-markets/issues/67)) ([ca22d6f](https://github.com/relativityAI/relativity-markets/commit/ca22d6fbb4a1a455f1095f18b6167e34787c0833))
* v3 skills pipeline — retry-hardened analysis, per-tool provenance, lightweight-charts plots ([#81](https://github.com/relativityAI/relativity-markets/issues/81)) ([18aa827](https://github.com/relativityAI/relativity-markets/commit/18aa82716626f4cc7e9f6c1116184ce002150049))
* verdict-led result redesign, GitHub skill import, report plots ([#93](https://github.com/relativityAI/relativity-markets/issues/93)) ([1072aa2](https://github.com/relativityAI/relativity-markets/commit/1072aa22de34165f17da6aefbe39c3710000dea0))


### Bug Fixes

* **api:** agent skills only, structure once, never clear state digests ([587d49a](https://github.com/relativityAI/relativity-markets/commit/587d49aae94e314d9d3db9baa3f42d48f87f46c5))
* backfill Voyager key when user_settings row exists but key is missing ([#25](https://github.com/relativityAI/relativity-markets/issues/25)) ([39461f0](https://github.com/relativityAI/relativity-markets/commit/39461f0d22b69dcf9501c7be4951ad6b07e6cf89))
* bounce logged-in users home from /index.html and unknown paths ([#37](https://github.com/relativityAI/relativity-markets/issues/37)) ([2f2b6df](https://github.com/relativityAI/relativity-markets/commit/2f2b6dfa4d90037dc2448f6300e9483eae87d15f))
* default agents never persisted (missing user_id); re-seed safely + respect deletes ([#59](https://github.com/relativityAI/relativity-markets/issues/59)) ([39b2c2f](https://github.com/relativityAI/relativity-markets/commit/39b2c2f10ac25eb007e86d61122eac411c08b42f))
* enable quantitative params in builder and manual editor ([#33](https://github.com/relativityAI/relativity-markets/issues/33)) ([ec57cc9](https://github.com/relativityAI/relativity-markets/commit/ec57cc93797b4fcf0582dfec44cc1e5f3e59b908))
* enable Voyager data pulls for SEC symbols ([#69](https://github.com/relativityAI/relativity-markets/issues/69)) ([6fcf748](https://github.com/relativityAI/relativity-markets/commit/6fcf748dab580ac933352c2391cc05ba8083933b))
* match Voyager admin API spec exactly (owner, rpm, expires_in_days required) ([#27](https://github.com/relativityAI/relativity-markets/issues/27)) ([8236961](https://github.com/relativityAI/relativity-markets/commit/8236961312ea7282e9e72a031c7b9f147615e07c))
* **report:** candle charts, volume bars, dump-time figure rendering ([bffc449](https://github.com/relativityAI/relativity-markets/commit/bffc4492118faab120eed83b83737f3b03e1c412))
* restore api artifacts modules unblocking Render build ([#91](https://github.com/relativityAI/relativity-markets/issues/91)) ([1adcdaa](https://github.com/relativityAI/relativity-markets/commit/1adcdaabc989eeb6e70e857bf9c7c131aa043a52))
* send POST /pull params as query string (Voyager expects query params) ([#70](https://github.com/relativityAI/relativity-markets/issues/70)) ([6a11df1](https://github.com/relativityAI/relativity-markets/commit/6a11df1c5d2e5ab3b5a7d54c43f1bb0161f8e447))
* strip _id from agent update payload, default source to NSE ([#23](https://github.com/relativityAI/relativity-markets/issues/23)) ([f4c27cf](https://github.com/relativityAI/relativity-markets/commit/f4c27cfef72fe49e6d334b29c2ccb2fac9ae6fe1))
* track src/lib so Render build can resolve motion and supabase ([#36](https://github.com/relativityAI/relativity-markets/issues/36)) ([fa5d4ef](https://github.com/relativityAI/relativity-markets/commit/fa5d4ef641cb780935c0e6fe50b719cb7accdfe8))
* update model list to current provider models ([#21](https://github.com/relativityAI/relativity-markets/issues/21)) ([90908df](https://github.com/relativityAI/relativity-markets/commit/90908dffb7db35dfd4b4e1c686d1c7d9539d8f1a))
* use correct Voyager admin API format (X-Voyager-Admin-Key header, name + scopes in body) ([#26](https://github.com/relativityAI/relativity-markets/issues/26)) ([f9c6bbc](https://github.com/relativityAI/relativity-markets/commit/f9c6bbc0fd980d7bc88c30ccbe3cd6a55fa0f035))
