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
│  │  CHAINLINK CRE WORKFLOW (chainlink-workflow/)                │   │
│  │                                                              │   │
│  │  Every 5 min on a DON:                                      │   │
│  │  1. Read expired markets from contract                      │   │
│  │  2. Download metadata from 0G Storage (resolution API spec) │   │
│  │  3. Fetch real-world outcome from public API                │   │
│  │  4. Call resolveMarket(id, winningOption)                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  FRONTEND (frontend/)                                        │   │
│  │  Next.js + Dynamic JS SDK                                   │   │
│  │  · Browse AI-generated markets                              │   │
│  │  · Connect wallet via Dynamic (embedded wallets supported)  │   │
│  │  · Place USDC bets                                          │   │
│  │  · Claim winnings                                           │   │
│  │  · View AI provenance on 0G Storage                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Sponsor Integration

| Sponsor | What it does | Why it's load-bearing |
|---|---|---|
| **0G Compute** | LLM inference that generates market ideas | Remove it → just a manual prediction market |
| **0G Storage** | Stores full AI provenance (model, prompt, sources, reasoning) | Remove it → no way to verify the AI's work |
| **Dynamic Node SDK** | Server wallet for the AI agent (no raw private keys) | Remove it → agent has no secure on-chain identity |
| **Dynamic JS SDK** | User wallet connect (embedded + external wallets) | Remove it → users can't bet |
| **Arc** | EVM L1, USDC-native settlement, prediction market contracts | Remove it → no stablecoin-native settlement layer |
| **Chainlink CRE** | Decentralized oracle that fetches outcomes and resolves markets | Remove it → someone has to be trusted admin |

---

## Project Structure

```
Hacky/
├── contracts/              Hardhat + Solidity
│   ├── contracts/
│   │   ├── PredictionMarket.sol
│   │   └── MockERC20.sol   (testing only)
│   ├── scripts/deploy.ts
│   ├── test/
│   └── hardhat.config.ts
│
├── agent/                  AI market generator
│   └── src/
│       ├── index.ts        Entry point + cron loop
│       ├── marketGenerator.ts  0G Compute / LLM calls
│       ├── zeroGStorage.ts     0G Storage upload/download
│       ├── dynamicWallet.ts    Dynamic server wallet API
│       ├── config.ts
│       └── logger.ts
│
├── chainlink-workflow/     CRE resolution workflow
│   └── src/
│       ├── workflow.ts     CRE workflow entry + config
│       ├── resolver.ts     Core resolution logic
│       ├── simulate.ts     Local simulation script
│       └── watcher.ts      Fallback polling watcher
│
└── frontend/               Next.js + Dynamic JS SDK
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   └── page.tsx
        ├── components/
        │   ├── DynamicProvider.tsx
        │   ├── Header.tsx
        │   ├── MarketCard.tsx
        │   └── BetModal.tsx
        └── lib/
            └── contract.ts
```

---

## Quick Start

### 1. Deploy the smart contract

```bash
cd contracts
cp .env.example .env
# Fill in DEPLOYER_PRIVATE_KEY, ARC_RPC_URL, AI_AGENT_ADDRESS, CHAINLINK_RESOLVER
npm install
npm run compile
npm run deploy:arc
```

### 2. Start the AI agent

```bash
cd agent
cp .env.example .env
# Fill in ZG_API_KEY, DYNAMIC_API_KEY, DYNAMIC_ENV_ID, CONTRACT_ADDRESS
npm install
npm start
```

On first run, the agent will:
- Get/create a Dynamic server wallet (print its address — add to contract as `aiAgent`)
- Call 0G Compute to generate 3 markets
- Upload metadata to 0G Storage
- Create markets on-chain

### 3. Simulate Chainlink CRE resolution

```bash
cd chainlink-workflow
cp .env.example .env
# Fill in RESOLVER_PRIVATE_KEY, CONTRACT_ADDRESS
npm install
npm run simulate
```

To deploy to the live CRE network, show Chainlink team the simulation output and they will deploy it for you during the hackathon.

### 4. Run the frontend

```bash
cd frontend
cp .env.example .env
# Fill in NEXT_PUBLIC_DYNAMIC_ENV_ID, NEXT_PUBLIC_CONTRACT_ADDRESS
npm install
npm run dev
```

Open http://localhost:3000

---

## Smart Contract — Key Design Decisions

**Only the AI agent can create markets** (`onlyAiAgent` modifier)
— No human admin. The `aiAgent` address is the Dynamic server wallet.

**Only Chainlink CRE can resolve markets** (`onlyChainlinkResolver` modifier)
— No human admin. The `chainlinkResolver` address is the CRE oracle.

**2% protocol fee** on winnings
— Sustainable revenue model. Fee goes to contract owner.

**0G Storage hash on-chain**
— Every market has an immutable pointer to its AI provenance.
Anyone can verify exactly which model created the market, what prompt was used,
and which API will be used to resolve it — all before placing a bet.

---

## Deployed Contracts

> Fill in after deployment

| Network | Address |
|---|---|
| Arc Testnet | `0x...` |

---

## Demo Video

> Link after recording

---

## Team

> Your names, Telegram handles, X handles
