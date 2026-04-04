# AlphaMarket — AI-Generated Prediction Markets

> **AI creates markets. Humans bet. Chainlink resolves. Settled in USDC on Arc.**

No human admin creates markets. No human admin resolves them.
The AI proposes. Chainlink disposes.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AlphaMarket                                  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  AGENT (agent/)                                               │   │
│  │                                                              │   │
│  │  1. 0G Compute (LLM)  ──generates──▶ Market ideas           │   │
│  │  2. 0G Storage        ──stores──────▶ AI provenance metadata │   │
│  │  3. Dynamic Node SDK  ──signs──────▶  createMarket() on Arc  │   │
│  └──────────────────────────────┬───────────────────────────────┘   │
│                                 │                                    │
│                          on-chain market                             │
│                                 │                                    │
│  ┌──────────────────────────────▼───────────────────────────────┐   │
│  │  SMART CONTRACT (Arc)                                        │   │
│  │  PredictionMarket.sol                                        │   │
│  │                                                              │   │
│  │  createMarket()  ◀── aiAgent only (Dynamic server wallet)   │   │
│  │  placeBet()      ◀── any user (USDC)                        │   │
│  │  resolveMarket() ◀── chainlinkResolver only                 │   │
│  │  claimWinnings() ◀── winners                                │   │
│  └──────────────────────────────┬───────────────────────────────┘   │
│                                 │                                    │
│                   expiry reached + outcome needed                    │
│                                 │                                    │
│  ┌──────────────────────────────▼───────────────────────────────┐   │
│  │  CHAINLINK CRE WORKFLOW (cre-workflow/)                      │   │
│  │                                                              │   │
│  │  Runs on a DON (Decentralized Oracle Network):              │   │
│  │  1. Read expired markets from contract                      │   │
│  │  2. Read live price from Chainlink Data Feed on-chain       │   │
│  │  3. Call resolveMarket(id, winningOption)                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  FRONTEND (frontend/)                                        │   │
│  │  Next.js + Dynamic JS SDK                                   │   │
│  │  · Browse AI-generated markets                              │   │
│  │  · Connect wallet via Dynamic (embedded wallets supported)  │   │
│  │  · Place USDC bets                                          │   │
│  │  · AI Trading Bot (session wallet, no popups)               │   │
│  │  · Claim winnings                                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Sponsor Integration

| Sponsor | What it does | Why it's load-bearing |
|---|---|---|
| **0G Compute** | LLM inference (LLaMA-70B) generates market ideas | Remove it → just a manual prediction market |
| **0G Storage** | Stores full AI provenance (model, prompt, sources, reasoning) | Remove it → no way to verify the AI's work |
| **Dynamic Node SDK** | Server wallet for the AI agent (no raw private keys) | Remove it → agent has no secure on-chain identity |
| **Dynamic JS SDK** | User wallet connect (embedded + external wallets) | Remove it → users can't bet |
| **Arc** | EVM L1, USDC-native settlement, prediction market contracts | Remove it → no stablecoin-native settlement layer |
| **Chainlink Data Feeds** | Live prices for market generation + trustless resolution | Remove it → someone has to be trusted admin |
| **Chainlink CRE** | Decentralized automation that resolves markets on-chain | Remove it → resolution requires a centralized server |

---

## Deployed Contracts

| Network | Address | Purpose |
|---|---|---|
| **Arc Testnet** | `0x9E584eA06196D97Db5539a24193E5DfEF356BA06` | Live demo — real USDC bets, AI markets |
| **Ethereum Sepolia** | `0xAE58C6968D1617754a1CDDdD45a31c1B3c2A1Fb2` | Cross-chain deployment proof |

---

## How Chainlink Is Used

### 1. Data Feeds — Price Oracle (Two Roles)

**Role 1 — AI market generation context:**
Before the AI generates a market, the agent reads live prices directly from Chainlink's `AggregatorV3Interface` contracts on Ethereum mainnet:
- `ETH/USD` — `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`
- `BTC/USD` — `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b`
- `SOL/USD` — `0x4ffC43a60e009B551865A93d232E33Fce9f01507`
- `AVAX/USD` — `0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7`
- `ETH Fast Gas` — `0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C`

The question threshold comes from real Chainlink data: *"Will ETH drop below $2,050 in 2 minutes?"* — that $2,050 is the live Chainlink price at market creation time.

**Role 2 — Trustless resolution:**
When a market expires, the same Chainlink feed is read again. The live price is compared to the threshold embedded in the question. The winner is determined on-chain with no human involvement. Anyone can verify the result on Etherscan.

**This is a closed loop: Chainlink opens the market and Chainlink closes it.**

---

### 2. Chainlink CRE — Decentralized Automation

Three TypeScript workflows built with `@chainlink/cre-sdk`, located in `cre-workflow/alphamarket-resolver/`.

#### Workflow 1 — Market Creation (`market-creation/`)
**Trigger:** Cron

- Uses `runtime.now()` for consensus timestamp (not a centralized clock)
- Encodes `ACTION_CREATE` with question, strike price, and expiry
- Calls `predictionMarket.writeReport()` — DON signs and submits on-chain

#### Workflow 2 — Market Resolution (`market-resolution/`)
**Trigger:** Cron (every 30 seconds in staging)

- Loops through market IDs and calls `isResolvable()` on-chain
- Reads `priceFeed.latestAnswer()` — live Chainlink price read inside the DON
- Encodes `ACTION_RESOLVE` and submits via `writeReport()`
- No centralized server involved — a network of Chainlink nodes reaches consensus

**Successfully simulated via CRE CLI:**
```
2026-04-04T14:29:45Z [USER LOG] Market 0: resolvable — reading price feed...
2026-04-04T14:29:47Z [USER LOG] BTC/USD price: $2051.28491863 (raw: 205128491863, decimals: 8)
2026-04-04T14:29:48Z [USER LOG] Market 0: resolved! Price: $2051.28
...
✓ Workflow Simulation Result: "Resolved markets: 0, 1, 2, 3, 4"
```

#### Workflow 3 — Dispute Management (`market-dispute/`)
**Trigger:** `LogTrigger` on `DisputeRaised` event

The most advanced workflow — fires automatically when anyone calls `raiseDispute()` on the contract:
1. Decodes the `DisputeRaised` event with typed bindings — gets `marketId`, `disputor`, `reason`
2. Verifies market is in `Disputed` status on-chain
3. Re-reads a **fresh** Chainlink price at that exact moment
4. Submits `ACTION_RESOLVE_DISPUTE` — can overturn an incorrect resolution

---

### Architecture Split — Arc vs Sepolia

| | Contract | Chain | Purpose |
|---|---|---|---|
| **Live demo** | `0x9E584...` | Arc Testnet | Real USDC betting, AI markets, live users |
| **Our Sepolia deploy** | `0xAE58C...` | Ethereum Sepolia | Cross-chain proof of deployment |
| **CRE simulation** | `0xEb792...` | Ethereum Sepolia | Chainlink's CRE-compatible interface contract |

**Why the split:** CRE runs on Sepolia today; our primary contract is on Arc (Circle's L1). The CRE workflows simulate against the CRE-compatible interface contract on Sepolia. The resolution logic is identical — in the live demo the backend reads the same Chainlink feeds and calls `resolveMarket()` on Arc. Adapting the Arc contract to implement `IReceiver` for full CRE integration is the production next step.

---

### One-Line Pitch for Chainlink

> "AlphaMarket uses Chainlink Data Feeds as both the AI's ground truth for generating markets and the trustless oracle for settling them — with Chainlink CRE automating the entire resolution lifecycle on a DON. Chainlink opens the market and Chainlink closes it."

---

## How 0G Is Used

### 1. 0G Compute — AI Market Generation

**Model:** `neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8`
**Endpoint:** `https://api.0g.ai/v1` (OpenAI-compatible)

Used in **three places:**

**1. Market generation (`agent/src/marketGenerator.ts` + `frontend/src/app/api/create-markets/route.ts`)**
Every 2 minutes the system calls 0G Compute with:
- Live Chainlink prices (ETH/USD, BTC/USD, SOL/USD, AVAX/USD, ETH Gas) injected into the prompt
- Fear & Greed index as sentiment context
- Instructions to generate binary prediction markets with exact Chainlink feed addresses for resolution

The LLM returns creative, contextually grounded questions like *"Will ETH/USD hold above $2,040 in 2min? (Chainlink: $2,054)"* — thresholds are derived from real live data, not hardcoded.

**2. Trading bot strategy parsing (`frontend/src/app/api/parse-strategy/route.ts`)**
When a user types a natural language strategy like *"Bet $0.5 on ETH markets when 20 seconds remain"*, the request is sent to 0G Compute which extracts structured parameters: asset filter, trigger timing, bet amount, max bets. Keyword fallback is used when no API key is configured.

---

### 2. 0G Storage — On-Chain AI Provenance

**SDK:** `@0glabs/0g-ts-sdk`
**Storage node:** `https://storage-node.0g.ai`

For every market created, the full AI provenance metadata is uploaded to 0G decentralized storage as a JSON blob:
```json
{
  "version": "1",
  "generatedAt": "2026-04-04T...",
  "modelId": "neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8",
  "question": "Will ETH/USD hold above $2,040 in 2min?",
  "options": ["Yes, holds above", "No, breaks below"],
  "confidence": 0.78,
  "reasoning": "ETH trading at $2,054. Key support at $2,040 (-0.7%)...",
  "resolutionApi": "chainlink://0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "sources": ["https://etherscan.io/address/0x5f4eC..."]
}
```

The 0G Storage root hash is stored **immutably on-chain** in the `storageHash` field of every market in `PredictionMarket.sol`. Anyone can take any market's storage hash and retrieve the full AI reasoning that created it — verifiable provenance from AI to on-chain.

**On-chain proof:** Every market on Arc testnet (`0x9E584eA06196D97Db5539a24193E5DfEF356BA06`) has a `storageHash` field. When `ZG_API_KEY` is configured, these are real `0g://` root hashes. Call `getMarket(id)` on the contract to see them.

---

### Why This Qualifies for 0G's "AI-Native DeFi" Bounty

AlphaMarket hits the exact use case 0G described: *"AI-powered prediction market with on-chain model provenance + verifiable AI inference"*

- **Autonomous** — no human creates or resolves markets, the AI + Chainlink do it all
- **Verifiable** — every market has a 0G Storage hash on-chain pointing to the exact model, prompt, and reasoning
- **Economically self-sustaining** — 2% protocol fee on all winnings funds ongoing operation

### ⚠️ Important: ZG_API_KEY Required

Without `ZG_API_KEY` set in `.env`, the system falls back to deterministic template markets and mock storage hashes (`0g://mock-...`). To demonstrate real 0G Compute usage:
1. Get an API key from `https://dashboard.0g.ai` or ask the 0G team at the hackathon
2. Add to `frontend/.env`: `ZG_API_KEY=your_key_here`
3. Markets will then be AI-generated and storage hashes will be real `0g://` root hashes verifiable on-chain

### One-Line Pitch for 0G

> "AlphaMarket uses 0G Compute (LLaMA-70B) to autonomously generate prediction markets grounded in live Chainlink data, and 0G Storage to store full AI provenance for every market — with the root hash stored immutably on-chain so anyone can verify which model created the market and why."

---

## How Dynamic Is Used

### 1. Dynamic JS SDK — User Wallet (Frontend)

**Package:** `@dynamic-labs/sdk-react-core`, `@dynamic-labs/ethereum`

`DynamicContextProvider` wraps the entire app with `EthereumWalletConnectors`, supporting MetaMask, embedded wallets, and any injected wallet out of the box.

**Hooks used across the app:**
- `useDynamicContext()` — `primaryWallet` (address + signer), `authToken` (JWT), `setShowDynamicUserProfile`, `handleLogOut`
- `useIsLoggedIn()` — gates the entire betting UI; unauthenticated users see connect prompt
- `useUserWallets()` — lists all linked wallets in the Player Profile panel

**Server-side JWT verification (`frontend/src/app/api/verify-user/route.ts`):**
When a user authenticates, Dynamic issues an RS256 JWT. The backend verifies it using Dynamic's JWKS endpoint (`https://app.dynamic.xyz/api/v0/sdk/{envId}/.well-known/jwks`) — pure Web Crypto API, no external libraries. The verified user identity is shown with a "JWT Verified" badge in the Player Profile.

---

### 2. Dynamic Node SDK — AI Agent Server Wallet (Backend)

**API:** `https://app.dynamic.xyz/api/v0`

The AI agent that creates markets on-chain uses a Dynamic **server wallet** as its identity — not a raw private key in a `.env` file:

1. On startup, the agent calls Dynamic's API to get or create a managed EVM wallet (`getOrCreateAgentWallet()`)
2. That wallet address is registered in `PredictionMarket.sol` as `aiAgent` — the **only** address allowed to call `createMarket()`
3. When creating a market, the agent POSTs the transaction payload to Dynamic's signing API — Dynamic holds the key, the agent never touches it
4. If the agent is compromised, the server wallet can be revoked via Dynamic's dashboard without redeploying the contract

**Why this matters:** The `onlyAiAgent` modifier in the smart contract means Dynamic's managed wallet is the on-chain gatekeeper for all market creation. No Dynamic → no new markets.

### One-Line Pitch for Dynamic

> "We use Dynamic on both ends — the JS SDK for user wallet connect with server-side JWT verification, and the Node SDK to give the AI agent a managed server wallet so it signs on-chain transactions without ever holding a private key."

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
├── agent/                      AI market generator
│   └── src/
│       ├── index.ts            Entry point + cron loop
│       ├── marketGenerator.ts  0G Compute / LLM calls
│       ├── chainlinkFeeds.ts   Reads live Chainlink prices on-chain
│       ├── zeroGStorage.ts     0G Storage upload/download
│       ├── dynamicWallet.ts    Dynamic server wallet API
│       └── config.ts
│
├── cre-workflow/
│   └── alphamarket-resolver/
│       ├── market-creation/    CRE Workflow 1 — Cron → createMarket()
│       ├── market-resolution/  CRE Workflow 2 — Cron → read feed → resolveMarket()
│       └── market-dispute/     CRE Workflow 3 — LogTrigger → re-read feed → resolveDispute()
│
└── frontend/                   Next.js + Dynamic JS SDK
    └── src/
        ├── app/
        │   ├── page.tsx
        │   └── api/
        │       ├── create-markets/   AI market generation endpoint
        │       ├── resolve-pending/  Backend resolution (reads Chainlink feeds)
        │       ├── markets/          Market list with caching
        │       ├── prices/           Live Chainlink price proxy
        │       └── parse-strategy/   0G AI bot strategy parser
        └── components/
            ├── MarketCard.tsx
            ├── BetModal.tsx
            ├── AiBotPanel.tsx      AI Trading Bot with session wallet
            ├── PlayerProfile.tsx
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

### 2. Simulate Chainlink CRE resolution

```bash
cd cre-workflow/alphamarket-resolver/market-resolution
bun install
cre workflow simulate market-resolution --target staging-settings
```

### 3. Deploy contract to Sepolia

```bash
cd contracts
USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
npx hardhat run scripts/deploy.ts --network sepolia
```

### 4. Deploy contract to Arc

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network arc
```

---

## Smart Contract — Key Design Decisions

**Only the AI agent can create markets** (`onlyAiAgent` modifier)
— No human admin. The `aiAgent` address is the Dynamic server wallet.

**Only Chainlink CRE can resolve markets** (`onlyChainlinkResolver` modifier)
— No human admin. The `chainlinkResolver` address is the CRE oracle.

**MIN_BET = 1000 (0.001 USDC)**
— Arc supports micropayments natively as USDC is the native gas token.

**2% protocol fee** on winnings
— Sustainable revenue model. Fee goes to contract owner.

**0G Storage hash on-chain**
— Every market has an immutable pointer to its AI provenance.
Anyone can verify exactly which model created the market, what prompt was used,
and which data feed resolves it — all before placing a bet.

---

## AI Trading Bot

The frontend includes an AI-powered trading bot (`AiBotPanel.tsx`) that:
- Accepts natural language strategy: *"Bet $0.1 on ETH markets when 20s remain"*
- Parses strategy via 0G Compute (LLaMA-70B) with keyword fallback
- Uses an **ephemeral session wallet** — fund once with MetaMask, bot bets silently with no further popups
- Monitors live Chainlink prices to determine which side to bet on
- Claims winnings automatically from the session wallet

---

## Demo Video

> Link after recording

---

## Team

> Your names, Telegram handles, X handles
