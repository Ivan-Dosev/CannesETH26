# AlphaMarket — AI-Generated Prediction Markets

> **AI creates markets. Humans bet. Chainlink resolves. Settled in USDC on Arc.**

No human admin creates markets. No human admin resolves them.
The AI proposes. Chainlink disposes.

---

## What Is AlphaMarket

AlphaMarket is an AI-powered prediction market platform on Arc where users bet native USDC on short-term crypto price questions. Traditional prediction markets like Polymarket and Kalshi are built around real-world events curated by humans. AlphaMarket is built for the agentic economy — every market is created by an AI agent, resolved by a decentralized oracle network, and settled on-chain with no human in the loop.

Users can bet manually or describe a trading strategy in plain English and deploy a personal AI bot that monitors markets and executes bets automatically — no wallet popups. Because Arc supports native USDC micropayments down to fractions of a cent (vs $1 minimum on Polymarket), AI agents can run hundreds of micro-strategies simultaneously at a cost that makes economic sense.

---

## Architecture

```
                              ┌─────────────────────┐
                              │   CHAINLINK FEEDS    │
                              │  ETH/BTC/SOL/AVAX   │
                              │   AggregatorV3       │
                              └──────┬──────────┬────┘
                          live prices│          │live prices
                                     │          │
          ┌──────────────────────────▼──┐    ┌──▼──────────────────────────┐
          │        AGENT (Node.js)      │    │   CHAINLINK CRE (DON)       │
          │                             │    │                             │
          │  0G Compute (LLaMA-70B)     │    │  market-resolution/         │
          │    · generate questions     │    │    Cron → isResolvable()    │
          │    · parse user strategies  │    │    → latestAnswer()         │
          │    · personalise by wallet  │    │    → resolveMarket()        │
          │                             │    │                             │
          │  0G Storage                 │    │  market-dispute/            │
          │    · upload AI provenance   │    │    LogTrigger on            │
          │    · storageHash on-chain   │    │    DisputeRaised event      │
          │                             │    │    → re-read price          │
          │  Dynamic Node SDK (MPC)     │    │    → overturn if wrong      │
          │    · DynamicEvmWalletClient │    │                             │
          │    · sign createMarket()    │    │  market-creation/           │
          │    · no raw private key     │    │    Cron → writeReport()     │
          └──────────────┬──────────────┘    └──────────────┬─────────────┘
                         │                                   │
                createMarket()                        resolveMarket()
                         │                                   │
          ┌──────────────▼───────────────────────────────────▼─────────────┐
          │          SMART CONTRACT — Arc Testnet                           │
          │          PredictionMarket.sol                                   │
          │          0x9E584eA06196D97Db5539a24193E5DfEF356BA06            │
          │                                                                 │
          │   createMarket()   ◀── onlyAiAgent (Dynamic MPC wallet)        │
          │   placeBet()       ◀── any user (native USDC, min 0.001)       │
          │   resolveMarket()  ◀── onlyChainlinkResolver (CRE DON)         │
          │   claimWinnings()  ◀── winners (2% protocol fee)               │
          │   storageHash      ──▶ immutable 0G provenance pointer         │
          └──────────────────────────────┬──────────────────────────────────┘
                                         │
                               read markets + place bets
                                         │
          ┌──────────────────────────────▼──────────────────────────────────┐
          │          FRONTEND — Next.js                                     │
          │                                                                 │
          │  Dynamic JS SDK (headless — @dynamic-labs-sdk/client)          │
          │    · Custom WalletModal                                         │
          │      — MetaMask / injected wallets                             │
          │      — Email OTP + embedded WaaS wallet                        │
          │    · Server-side JWT verification (JWKS / Web Crypto API)      │
          │                                                                 │
          │  Market UI                                                      │
          │    · Browse AI-generated markets (live / awaiting / resolved)  │
          │    · 5-step bet journey (placed → awaiting → won/lost → claim) │
          │    · Tx hash link on ArcScan after every bet                   │
          │                                                                 │
          │  AI Trading Bot (AiBotPanel)                                   │
          │    · Plain English strategy → 0G Compute parses parameters     │
          │    · Ephemeral session wallet funded once (one MetaMask popup) │
          │    · Bot bets silently — no further popups                     │
          │    · Monitors live Chainlink prices to pick winning side       │
          │    · Claims winnings automatically from session wallet         │
          └─────────────────────────────────────────────────────────────────┘
```

---

## Sponsor Integration

| Sponsor | What it does | Why it matters |
|---|---|---|
| **0G Compute** | LLaMA-70B generates market questions grounded in live Chainlink prices | Remove it → manual prediction market |
| **0G Storage** | Stores full AI provenance (model, prompt, reasoning, confidence) per market | Remove it → no verifiable AI audit trail |
| **Arc** | EVM L1 with native USDC — micropayments to fractions of a cent | Remove it → $1 minimums kill agent trading |
| **Chainlink Data Feeds** | Live prices for market generation + trustless resolution | Remove it → someone has to be trusted admin |
| **Chainlink CRE** | Three DON workflows automate market resolution and dispute handling | Remove it → resolution requires a centralized server |

---

## Deployed Contracts

| Network | Address | Purpose |
|---|---|---|
| **Arc Testnet** | `0x9E584eA06196D97Db5539a24193E5DfEF356BA06` | Live demo — real USDC bets, AI markets |
| **Ethereum Sepolia** | `0xAE58C6968D1617754a1CDDdD45a31c1B3c2A1Fb2` | Cross-chain deployment proof |

---

## How Chainlink Is Used

### 1. Data Feeds — Dual Role

**Role 1 — Market generation context:**
Before the AI generates a market, the agent reads live prices from Chainlink `AggregatorV3Interface` contracts:
- `ETH/USD` — `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`
- `BTC/USD` — `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b`
- `SOL/USD` — `0x4ffC43a60e009B551865A93d232E33Fce9f01507`
- `AVAX/USD` — `0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7`
- `ETH Fast Gas` — `0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C`

Every question threshold is the real live Chainlink price at creation time: *"Will ETH hold above $2,040 in 2 minutes?"* — that $2,040 is the live feed value.

**Role 2 — Trustless resolution:**
When a market expires, the same Chainlink feed is read again. The live price is compared to the threshold. The winner is determined on-chain with no human involvement.

**The same feed that opens the market closes it.**

---

### 2. Chainlink CRE — Three Workflows

Located in `cre-workflow/alphamarket-resolver/`, built with `@chainlink/cre-sdk`.

#### Workflow 1 — Market Resolution (`market-resolution/`)
**Trigger:** Cron (every 30 seconds in staging)

- Loops through market IDs and calls `isResolvable()` on-chain
- Reads `priceFeed.latestAnswer()` — live price read inside the DON
- Encodes `ACTION_RESOLVE` and submits via `writeReport()`
- No centralized server involved — Chainlink nodes reach consensus

**Successfully simulated:**
```
[USER LOG] Market 0: resolvable — reading price feed...
[USER LOG] BTC/USD price: $2051.28 (raw: 205128491863, decimals: 8)
[USER LOG] Market 0: resolved!
✓ Workflow Simulation Result: "Resolved markets: 0, 1, 2, 3, 4"
```

#### Workflow 2 — Dispute Management (`market-dispute/`)
**Trigger:** `LogTrigger` on `DisputeRaised` event

Fires automatically when anyone calls `raiseDispute()` on the contract:
1. Decodes the `DisputeRaised` event — gets `marketId`, `disputor`, `reason`
2. Verifies market is in `Disputed` status on-chain
3. Re-reads a fresh Chainlink price at that exact moment
4. Submits `ACTION_RESOLVE_DISPUTE` — can overturn an incorrect resolution

#### Workflow 3 — Market Creation (`market-creation/`)
**Trigger:** Cron

- Uses `runtime.now()` for consensus timestamp
- Encodes `ACTION_CREATE` with question, strike price, and expiry
- Calls `predictionMarket.writeReport()` — DON signs and submits on-chain

---

### Architecture Split — Arc vs Sepolia

| | Contract | Chain | Purpose |
|---|---|---|---|
| **Live demo** | `0x9E584...` | Arc Testnet | Real USDC betting, AI markets, live users |
| **Our Sepolia deploy** | `0xAE58C...` | Ethereum Sepolia | Cross-chain proof of deployment |
| **CRE simulation** | `0xEb792...` | Ethereum Sepolia | Chainlink's CRE-compatible interface contract |

CRE runs on Sepolia today. Our primary contract is on Arc. The CRE workflows simulate against the CRE-compatible interface on Sepolia — the resolution logic is identical. Adapting the Arc contract to implement `IReceiver` for full live CRE integration is the production next step.

---

### One-Line Pitch for Chainlink

> "AlphaMarket uses Chainlink Data Feeds as both the AI's ground truth for generating markets and the trustless oracle for settling them — with three Chainlink CRE workflows automating the entire resolution lifecycle on a DON. The same feed that opens the market closes it."

---

## How 0G Is Used

### 1. 0G Compute — AI Market Generation

**Model:** `neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8`
**Endpoint:** `https://api.0g.ai/v1` (OpenAI-compatible API)

Used in three places:

**Market generation** (`agent/src/marketGenerator.ts`)
Every cycle the agent calls 0G Compute with live Chainlink prices injected into the prompt. The LLM returns binary prediction markets with thresholds derived from real data — not hardcoded.

**Trading bot strategy parsing** (`frontend/src/app/api/parse-strategy/route.ts`)
When a user types *"Bet $0.5 on ETH markets when 20 seconds remain"*, the request goes to 0G Compute which extracts structured parameters: asset filter, trigger timing, bet amount, max bets. Keyword fallback is used when no API key is configured.

**Personalised market selection**
The agent reads the user's on-chain wallet history and generates questions relevant to their actual trading behaviour. If your wallet shows ETH and SOL activity, you see ETH and SOL markets.

---

### 2. 0G Storage — On-Chain AI Provenance

**SDK:** `@0glabs/0g-ts-sdk`

For every market created, the full AI provenance is uploaded to 0G decentralized storage:
```json
{
  "version": "1",
  "generatedAt": "2026-04-05T...",
  "modelId": "neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8",
  "question": "Will ETH/USD hold above $2,040 in 2min?",
  "options": ["Yes, holds above", "No, breaks below"],
  "confidence": 0.78,
  "reasoning": "ETH trading at $2,054. Key support at $2,040...",
  "resolutionApi": "chainlink://0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "sources": ["https://etherscan.io/address/0x5f4eC..."]
}
```

The 0G Storage root hash is stored immutably on-chain in the `storageHash` field of every market. Anyone can take a market's storage hash and retrieve the full AI reasoning that created it.

**On-chain proof:** Call `getMarket(id)` on `0x9E584eA06196D97Db5539a24193E5DfEF356BA06` — every market has a `storageHash` field.

> **Note:** Without `ZG_API_KEY` the system falls back to template markets and mock hashes (`0g://mock-...`). Get a key from `https://dashboard.0g.ai` and add it to `frontend/.env` and `agent/.env`.

---

### One-Line Pitch for 0G

> "AlphaMarket uses 0G Compute (LLaMA-70B) to autonomously generate prediction markets grounded in live Chainlink data, and 0G Storage to store full AI provenance for every market — with the root hash stored immutably on-chain so anyone can verify which model created the market and why."

---

## How Dynamic Is Used

### 1. Dynamic JS SDK — User Wallet (Frontend)

**Packages:** `@dynamic-labs-sdk/client`, `@dynamic-labs-sdk/evm`

Fully headless — we built a custom wallet modal from scratch using Dynamic's JS SDK (no pre-built widget). Supports:
- MetaMask and any injected EVM wallet via `getAvailableWalletProvidersData()` + `connectAndVerifyWithWalletProvider()`
- Email OTP embedded wallets via `sendEmailOTP()` + `verifyOTP()` + `createWaasWalletAccounts()`

**Server-side JWT verification** (`frontend/src/app/api/verify-user/route.ts`):
Dynamic issues an RS256 JWT on login. The backend verifies it using Dynamic's JWKS endpoint — pure Web Crypto API, no external libraries. Verified users see a "JWT Verified" badge.

### 2. Dynamic Node SDK — AI Agent Server Wallet (Backend)

**Package:** `@dynamic-labs-wallet/node-evm`

The AI agent uses `DynamicEvmWalletClient` for its on-chain identity:
1. `authenticateApiToken()` — authenticates with Dynamic API key
2. `getEvmWallets()` or `createWalletAccount()` — gets or creates an MPC wallet
3. Key shares are persisted locally so signing works across restarts
4. `signTransaction()` — signs transactions without the full private key ever existing in one place

The agent's MPC wallet address is registered in `PredictionMarket.sol` as `aiAgent` — the only address allowed to call `createMarket()`. If the agent is compromised, one dashboard click revokes signing rights without redeploying the contract.

---

## AI Trading Bot

The frontend includes an AI-powered trading bot (`AiBotPanel.tsx`):

1. User types a strategy in plain English: *"Bet $0.1 on ETH markets when 20s remain"*
2. 0G Compute (LLaMA-70B) parses it into structured parameters
3. An ephemeral **session wallet** is generated in memory — funded once from the user's main wallet (one MetaMask popup)
4. The session wallet is pre-approved for USDC spending — no further popups ever
5. The bot monitors live Chainlink prices, picks the right side, places bets, and claims winnings silently

Bot bets are tracked separately with a `betFromSession` flag so claim uses the session wallet signer automatically.

---

## Smart Contract Design

**`onlyAiAgent` modifier** — only the Dynamic MPC server wallet can create markets. No human admin.

**`onlyChainlinkResolver` modifier** — only the Chainlink CRE oracle can resolve markets. No human admin.

**`MIN_BET = 1000` (0.001 USDC)** — Arc's native USDC enables micropayments impossible on other chains. This is what makes AI agent trading economically viable.

**`storageHash` field** — every market has an immutable on-chain pointer to its 0G AI provenance.

**2% protocol fee** on winnings — sustainable revenue model.

---

## Project Structure

```
Hacky/
├── contracts/                  Hardhat + Solidity
│   ├── contracts/
│   │   └── PredictionMarket.sol
│   ├── scripts/deploy.ts
│   └── hardhat.config.ts       Arc + Sepolia networks configured
│
├── agent/                      AI market generator (Node.js)
│   └── src/
│       ├── index.ts            Entry point + cron loop
│       ├── marketGenerator.ts  0G Compute / LLM calls
│       ├── chainlinkFeeds.ts   Reads live Chainlink prices on-chain
│       ├── zeroGStorage.ts     0G Storage upload/download
│       ├── dynamicWallet.ts    Dynamic Node SDK MPC wallet
│       └── config.ts
│
├── cre-workflow/
│   └── alphamarket-resolver/
│       ├── market-creation/    CRE Workflow 1 — Cron → createMarket()
│       ├── market-resolution/  CRE Workflow 2 — Cron → price feed → resolveMarket()
│       └── market-dispute/     CRE Workflow 3 — LogTrigger → re-read → resolveDispute()
│
└── frontend/                   Next.js + Dynamic JS SDK (headless)
    └── src/
        ├── app/
        │   ├── page.tsx
        │   └── api/
        │       ├── create-markets/   AI market generation endpoint
        │       ├── resolve-pending/  Backend resolution (reads Chainlink feeds)
        │       ├── markets/          Market list
        │       ├── prices/           Live Chainlink price proxy
        │       └── parse-strategy/   0G AI bot strategy parser
        └── components/
            ├── MarketCard.tsx        5-step bet journey UI
            ├── BetModal.tsx          Bet + claim with tx hash confirmation
            ├── WalletModal.tsx       Custom Dynamic JS SDK wallet connect
            ├── AiBotPanel.tsx        AI Trading Bot with session wallet
            ├── PlayerProfile.tsx     Stats + JWT verified badge
            └── Header.tsx
```

---

## Quick Start

### 1. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3002

### 2. Run the agent

```bash
cd agent
npm install
npm run dev
```

Fill in `agent/.env`:
```
CONTRACT_ADDRESS=0x9E584eA06196D97Db5539a24193E5DfEF356BA06
ARC_RPC_URL=https://rpc.testnet.arc.network
DEPLOYER_PRIVATE_KEY=your_key
DYNAMIC_API_KEY=dyn_...
DYNAMIC_ENV_ID=your_env_id
ZG_API_KEY=your_0g_key
```

### 3. Simulate Chainlink CRE resolution

```bash
cd cre-workflow/alphamarket-resolver/market-resolution
bun install
cre workflow simulate market-resolution --target staging-settings
```

### 4. Deploy contract to Arc

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network arc
```

### 5. Deploy contract to Sepolia

```bash
cd contracts
USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
npx hardhat run scripts/deploy.ts --network sepolia
```

---

## Why AlphaMarket Wins

- **No humans in the loop** — AI creates, Chainlink resolves, Arc settles
- **Personalised markets** — generated from your on-chain wallet history
- **Plain English bot** — describe a strategy, the AI trades it for you
- **Micropayments** — fractions of a cent per bet, making agent trading viable
- **Verifiable AI** — every market has a cryptographic receipt on 0G Storage locked on-chain
- **Truly trustless** — the same oracle that inspired the question answers it

---

## Team

> Your names, Telegram handles, X handles
