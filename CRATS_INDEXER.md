# CRATS Blockchain Indexer
### Enterprise Event-Sourced Architecture — COPYm / CRATS Protocol

> **Version**: 3.0 — Phase 2 Production Release  
> **Network**: Ethereum Sepolia Testnet (`chainId: 11155111`)  
> **Stack**: Node.js · JavaScript · Express · MySQL · Viem · Prisma · PM2  

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Project Structure](#project-structure)
4. [Database Architecture](#database-architecture)
5. [Smart Contract Coverage](#smart-contract-coverage)
6. [Phase 1 — Real-Time Ledger Ingestion](#phase-1--real-time-ledger-ingestion)
7. [Phase 2 — Historical Backfill Engine](#phase-2--historical-backfill-engine)
8. [Event Projection System](#event-projection-system)
9. [REST API Reference](#rest-api-reference)
10. [Blockchain Explorer UI](#blockchain-explorer-ui)
11. [Transaction Data Captured](#transaction-data-captured)
12. [Vault & Asset Tracking](#vault--asset-tracking)
13. [Investor & Identity Details](#investor--identity-details)
14. [Chain Reorganization Handling](#chain-reorganization-handling)
15. [Running the Indexer](#running-the-indexer)

---

## Overview

The **CRATS Blockchain Indexer** is an enterprise-grade, event-sourced blockchain data pipeline built for the COPYm / CRATS Protocol on Ethereum. It continuously listens to the Sepolia network, decodes smart contract events from a curated registry of 23+ contracts, persists structured data to MySQL, and serves it via a REST API with a premium dark-themed Explorer UI.

The system follows an **immutable event ledger** pattern — every decoded on-chain event is stored exactly once as a `BlockchainEvent` record, and multiple independent read-model **projections** are derived from those events. This makes the system fully auditable and replayable.

---

## Architecture Principles

| Principle | Implementation |
|-----------|---------------|
| **Immutable Event Ledger** | Every on-chain event is stored in `blockchain_events` with `isRemoved` flag for reorg handling |
| **Event Sourcing** | All read models (Vaults, Portfolios, Fees, etc.) are derived from event replay, not direct mutations |
| **Idempotent Processing** | All DB upserts use unique keys (`txHash + logIndex`); safe to reprocess any block |
| **Separation of Concerns** | Block sync, event decoding, projections, and API are independent modules |
| **Resumable Sync** | `sync_status` table tracks the last synced block; backfill always resumes from where it stopped |

---

## Project Structure

```
crats-indexer/
├── prisma/
│   └── schema.prisma           # Full MySQL database schema (15 models)
├── src/
│   ├── api/
│   │   └── server.js           # Express REST API server (40+ endpoints)
│   ├── config/
│   │   ├── contractABIs.js     # Loads all Hardhat artifact ABIs + ERC-20 ABI
│   │   ├── db.js               # Prisma client singleton
│   │   ├── logger.js           # Winston logger
│   │   └── viem.js             # Viem public client (Alchemy RPC)
│   ├── projections/
│   │   ├── analyticsProjection.js   # Protocol TVL & metrics
│   │   ├── feeProjection.js         # Fee record accumulation
│   │   ├── navProjection.js         # NAV submission tracking
│   │   ├── portfolioProjection.js   # Portfolio positions + TokenHolder leaderboard
│   │   ├── settlementProjection.js  # Async vault settlement tracking
│   │   └── vaultProjection.js       # Vault creation & TVL updates
│   ├── scripts/
│   │   ├── backfill.js         # Historical data backfill engine
│   │   └── replay.js           # Event replay engine (projection rebuild)
│   ├── sync/
│   │   ├── blockSync.js        # Real-time block-by-block sync loop
│   │   └── eventDecoder.js     # Viem-based event ABI decoder
│   ├── workers/
│   │   └── projectionWorker.js # Background projection processing worker
│   └── index.js                # Application entry point (starts all services)
├── ui/
│   ├── styles.css              # Premium dark-theme CSS design system
│   ├── app.js                  # Vanilla JS SPA router & page controllers
│   ├── dashboard.html          # Main dashboard with protocol stats
│   ├── blocks.html             # Paginated block explorer list
│   ├── block.html              # Block detail page with all transactions
│   ├── transactions.html       # Paginated transaction explorer list
│   ├── transaction.html        # Full transaction detail with gas fee breakdown
│   ├── contracts.html          # All tracked contracts registry
│   ├── contract.html           # Contract detail with event history
│   ├── assets.html             # All tokenized assets & vaults list
│   ├── asset.html              # Asset detail with investors leaderboard
│   └── wallet.html             # Wallet profile, portfolio & event history
├── scratch/                    # Utility & one-off maintenance scripts
├── ecosystem.config.js         # PM2 process manager config
└── package.json
```

---

## Database Architecture

The database has **15 Prisma models** (MySQL tables):

### Infrastructure / Ledger Tables

| Table | Purpose |
|-------|---------|
| `blockchain_events` | **The immutable event ledger.** Every decoded smart contract event with full payload, block info, and processing status |
| `indexed_blocks` | Tracks which blocks have been ingested by the real-time sync loop |
| `processed_events` | Tracks which events have been processed by which projection (idempotency guard) |
| `projection_state` | Current checkpoint pointer for each projection worker |
| `dead_letter_events` | Failed projection events for DLQ/retry handling |
| `sync_metrics` | Key/value table for current sync progress indicators |

### Explorer Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `blocks` | Every indexed block header | `blockNumber`, `blockHash`, `parentHash`, `timestamp`, `gasUsed`, `txCount` |
| `transactions` | Every indexed transaction | `txHash`, `fromAddress`, `toAddress`, `value`, `gasUsed`, `gasLimit`, `gasPrice`, `transactionFee`, `tokenName`, `tokenSymbol`, `tokenAmount`, `method`, `status` |
| `logs` | Every raw event log | `txHash`, `logIndex`, `address`, `topics`, `data` (LONGTEXT) |
| `sync_status` | Backfill progress tracker | `chainId`, `lastSyncedBlock`, `latestBlock`, `progressPercentage`, `status` |
| `failed_blocks` | Blocks that failed to process | `blockNumber`, `error`, `retryCount` |

### Read Model / Projection Tables

| Table | Purpose |
|-------|---------|
| `vaults` | All created vaults with TVL, totalShares, creator, type (SYNC/ASYNC) |
| `portfolio_positions` | Per-wallet per-vault share balances |
| `token_holders` | Per-token per-wallet balance (leaderboard / top holders) |
| `fee_records` | All protocol fee events (management, performance, entry, exit, trading) |
| `settlements` | Async vault redemption/settlement lifecycle states |
| `nav_submissions` | NAV oracle price submissions |
| `protocol_metrics` | Aggregate protocol TVL, fees, active vault count |

---

## Smart Contract Coverage

The indexer tracks **23 static contracts** plus unlimited **dynamic vault clones**:

| Contract | Address | Type | Events |
|----------|---------|------|--------|
| IdentityRegistry | `0xA8605BBF...7F732D` | Custom | IdentityRegistered, IdentityUpdated |
| IdentitySBT | `0x5e88d8a8...7A7` | ERC-721 | SBT mint, revoke |
| KYCRegistry | `0xb4C0CD81...9Dc5c` | Custom | ProviderRegistered, ProviderStatusChanged |
| ComplianceModule | `0xE48e8F4b...37ab8e` | Custom | Compliance check events |
| TravelRuleModule | `0x962f9f55...392F60` | Custom | Travel rule events |
| InvestorRightsRegistry | `0xe30315Bb...59c5` | Custom | RightsRegistered, DividendClaimed, VoteExercised |
| CircuitBreaker | `0x010de9e1...d28A6` | Custom | Breaker trigger events |
| AssetFactory | `0xeCd44390...695F05` | Factory | AssetCreated events |
| AssetRegistry | `0xb103311F...7ED62f` | Custom | Asset registered events |
| RealEstatePlugin | `0xC5c3c091...77496` | Plugin | Plugin events |
| VaultFactory | *(from env)* | Factory | **VaultCreated** → triggers dynamic ABI registration |
| YieldDistributor | *(from env)* | System | Yield distribution events |
| FeeEngine | *(from env)* | Fee | FeeCharged, FeeDistributed |
| NAVOracle | *(from env)* | Oracle | NAVSubmitted, NAVVerified |
| PriceOracle | *(from env)* | Oracle | PriceUpdated |
| MarketplaceFactory | *(from env)* | Factory | MarketplaceCreated |
| OrderBookEngine | *(from env)* | Marketplace | OrderPlaced, OrderFilled, OrderCancelled |
| SettlementEngine | *(from env)* | Settlement | SettlementInitiated, SettlementCompleted |
| ClearingHouse | *(from env)* | Settlement | TradeCleared |
| Timelock | *(from env)* | Governance | Governance events |
| RedemptionManager | *(from env)* | Settlement | Redemption events |
| USDC | *(from env)* | ERC-20 | Transfer, Approval |
| USDT | *(from env)* | ERC-20 | Transfer, Approval |
| **SyncVault** *(dynamic)* | Auto-discovered via VaultCreated | ERC-20 + ERC-4626 | **Deposit, Withdraw, Transfer**, all vault events |
| **AsyncVault** *(dynamic)* | Auto-discovered via VaultCreated | ERC-20 + ERC-4626 | **DepositRequest, RedeemRequest**, settlement events |

---

## Phase 1 — Real-Time Ledger Ingestion

**File**: `src/sync/blockSync.js`

The real-time sync loop runs continuously with a 100ms polling interval after each successful block and 2s cooldown when at chain head.

### What it does per block:
1. **Fetch block** with full transaction objects via `eth_getBlock(blockNum, includeTransactions: true)`
2. **Fetch all receipts** in a single RPC call via `eth_getBlockReceipts` (falls back to individual `eth_getTransactionReceipt` on 429 errors)
3. **Persist Block record** to `blocks` table (upsert)
4. For each transaction:
   - **Extract gas details**: `gasUsed`, `gasLimit`, `gasPrice` (from `effectiveGasPrice`), compute `transactionFee = gasUsed × gasPrice`
   - **Detect token movements**: Scan receipt logs for `Transfer`, `Deposit`, `Withdraw` events from tracked contracts. Resolve `tokenName`, `tokenSymbol`, and `tokenAmount` and persist alongside the transaction
   - **Save Transaction** to `transactions` table (upsert)
   - For each receipt log:
     - **Save raw log** to `logs` table (upsert)
     - If address is tracked → decode via ABI → **save `BlockchainEvent`** to `blockchain_events` (upsert, status: `pending`)
     - If event is `VaultCreated` → **dynamically register** the new vault contract ABI into the in-memory registry
5. **Persist IndexedBlock** record to mark the block as synced
6. Update `sync_metrics` with current chain head and indexed block

### Chain Reorganization Recovery:
- On each new block, the `parentHash` is compared against the stored `blockHash` of the previous block
- On mismatch: walks backwards from the reorged block, finds the common ancestor, deletes all `IndexedBlock` records after it, marks affected `BlockchainEvent` records as `reorg_removed`, and resets all projection states to trigger full replay

---

## Phase 2 — Historical Backfill Engine

**File**: `src/scripts/backfill.js`  
**Command**: `npm run backfill`

Scans all blocks from `START_BLOCK` (default: `11115300`) to the current chain head.

### Features:
- **Resumable**: Reads `lastSyncedBlock` from `sync_status` table and starts from `lastSyncedBlock + 1`. Never restarts from scratch.
- **Concurrent block processing**: Processes blocks in batches of 100, with 5 concurrent workers per batch
- **Batch receipts**: Uses `eth_getBlockReceipts` to fetch all transaction receipts in a single call per block, with fallback to sequential queries
- **Rate limit tolerance**: Exponential backoff retry on 429 errors (3 retries, 2s/4s/6s delays)
- **Same data as real-time**: Saves all block, transaction, log, and event data identically to the live sync loop
- **Token extraction**: Decodes transfer/deposit/withdraw events to populate `tokenName`, `tokenSymbol`, `tokenAmount` on transactions
- **Progress tracking**: Updates `sync_status` table after every batch with `lastSyncedBlock`, `progressPercentage`, and `status`
- **Failed block tracking**: Blocks that fail after all retries are stored in `failed_blocks` for manual retry

---

## Event Projection System

**Directory**: `src/projections/`  
**Replay command**: `npm run replay -- --all` or `npm run replay -- --projection=portfolio`

Each projection is a pure function `(event, prismaTransaction) => void` that reads `BlockchainEvent` payloads and writes to read model tables.

| Projection | Events Processed | Output Tables |
|------------|-----------------|---------------|
| **VaultProjection** | `VaultCreated`, `VaultRegistered`, `Deposit`, `Withdraw`, `Transfer`, `StrategyActivated` | `vaults` (TVL, totalShares) |
| **PortfolioProjection** | `Deposit`, `Withdraw`, `Transfer` | `portfolio_positions`, `token_holders` |
| **FeeProjection** | `FeeCharged`, `ManagementFeeCharged`, `PerformanceFeeCharged` | `fee_records` |
| **SettlementProjection** | `DepositRequest`, `RedeemRequest`, `DepositSettled`, `RedeemSettled`, `RequestCancelled` | `settlements` |
| **NAVProjection** | `NAVSubmitted`, `NAVVerified`, `NAVPublished`, `NAVDisputed` | `nav_submissions` |
| **AnalyticsProjection** | `Deposit`, `Withdraw`, `VaultCreated` | `protocol_metrics` (aggregate TVL, fees) |

### Token Holder Leaderboard
The `token_holders` table is maintained by the `PortfolioProjection` for three event types:
- **Deposit** → increments `balance` for the depositor's wallet
- **Withdraw** → decrements `balance` for the withdrawer's wallet
- **Transfer** → decrements sender, increments receiver (skips mint address `0x0...0`)

This leaderboard covers both **dynamic vaults** (SYNC/ASYNC) and **static tokens** (USDC/USDT).

---

## REST API Reference

Base URL: `http://localhost:5001`

### Explorer APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard` | Protocol stats, recent blocks, recent transactions |
| `GET` | `/api/blocks?page=1&limit=10` | Paginated block list |
| `GET` | `/api/blocks/:number` | Block detail + all transactions inside |
| `GET` | `/api/transactions?page=1&limit=10` | Paginated transaction list |
| `GET` | `/api/transactions/:hash` | Full transaction detail + raw logs |
| `GET` | `/api/contracts` | All tracked contracts (static + dynamic vaults) |
| `GET` | `/api/contracts/:address` | Contract detail + recent decoded events |
| `GET` | `/api/assets` | All tokenized assets with holder counts |
| `GET` | `/api/assets/:id` | Asset detail + enriched investor leaderboard + transfer history |
| `GET` | `/api/wallets/:address` | Wallet profile, portfolio positions, event history |
| `GET` | `/api/search?q=` | Universal search (block number / tx hash / address / symbol) |
| `GET` | `/api/sync-status` | Live sync progress, block counts, event counts |

### Protocol & Portfolio APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/vaults` | All vaults list |
| `GET` | `/vaults/:id` | Vault detail |
| `GET` | `/vaults/:id/statistics` | Vault TVL, share price, AUM |
| `GET` | `/portfolio/:wallet` | Portfolio positions for a wallet |
| `GET` | `/portfolio/:wallet/history` | Event history for a wallet |
| `GET` | `/protocol/tvl` | Total protocol TVL |
| `GET` | `/protocol/fees` | Total fees accrued |
| `GET` | `/protocol/analytics` | Protocol analytics snapshot |

### Admin & Audit APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health check with chain lag |
| `GET` | `/admin/sync-status` | Detailed sync metrics |
| `GET` | `/admin/dead-letters` | Dead-letter queue events |
| `GET` | `/audit/event/:txHash` | All events for a transaction |
| `GET` | `/audit/portfolio/:wallet` | Portfolio-relevant events for a wallet |
| `GET` | `/audit/vault/:id` | All events for a vault |

---

## Blockchain Explorer UI

**Directory**: `ui/`  
**Served by**: Express static middleware from `src/api/server.js`  
**Access**: `http://localhost:5001/` → redirects to `/dashboard.html`

### Design System
- **Theme**: Premium dark mode (`#0B0F19` background, glassmorphism cards)
- **Typography**: Google Fonts — *Outfit* (300–800 weights)
- **Colors**: Blue primary (`#2563EB`), Emerald success (`#10B981`), Red danger (`#EF4444`)
- **Animations**: Sync spinner, hover transitions, progress bar smooth fills

### Pages

#### Dashboard (`/dashboard.html`)
- Protocol stats grid: Latest Block, Total Transactions, Total Contracts, Total Assets, Active Vaults, Total Events, Network Status, Sync Progress
- Live sync progress bar polling every 5 seconds
- Recent Blocks feed (last 10)
- Recent Transactions feed (last 10)
- Global search bar (routes to block/tx/address/asset)

#### Blocks (`/blocks.html` → `/block.html`)
- Paginated block list with: Block #, Timestamp, Tx Count, Gas Used, Block Hash
- Block detail: full metadata + all transactions in that block

#### Transactions (`/transactions.html` → `/transaction.html`)
- Paginated transaction list with: Tx Hash, Block, Timestamp, From, To/Contract, Method, Value, Status
- **Transaction detail** (fully enriched):
  - Transaction Hash, Status badge (SUCCESS/REVERTED)
  - Block Number, Timestamp (relative + absolute)
  - From Address (wallet link), To/Contract (wallet/contract link)
  - Method signature (4-byte hex)
  - **Value (Native ETH)**
  - **Token Asset Movement** — highlighted banner showing token name, symbol, and amount transferred if the transaction involved a vault deposit/withdrawal or ERC-20 transfer
  - **Gas Limit** (max gas allocated)
  - **Gas Used** (actual gas consumed + percentage of limit)
  - **Gas Price** (in Gwei and Wei)
  - **Total Gas Fee** (gasUsed × gasPrice, shown in ETH, highlighted in amber)
  - All emitted raw receipt logs (address, topics, data)

#### Contracts (`/contracts.html` → `/contract.html`)
- Lists all 23 static system contracts + all dynamically discovered vault clones
- Contract detail: address, label, type, total transactions, last activity, recent decoded events

#### Assets & Vaults (`/assets.html` → `/asset.html`)
- Lists all tokenized assets (USDC, USDT, plus all SyncVault/AsyncVault clones) with holder counts
- **Asset detail** (full-width layout):
  - Token address, name, symbol, total shares supply, holder count
  - **Top Active Holders Leaderboard** with 5 columns:
    - Holder Wallet (linked to wallet profile)
    - **KYC Status** (Verified badge in green / Unverified badge in gray)
    - **Investor Role** (Retail / Accredited / Institutional / Regulator)
    - **Jurisdiction** (country code from IdentityRegistry ledger event)
    - Balance Shares (sorted descending)
  - Recent Transfer / Deposit / Withdraw events with decoded payload JSON

#### Wallet (`/wallet.html`)
- Wallet address header
- Stats: Portfolio Value, Unique Assets Owned, Total Transactions, Vault Deposits/Withdrawals
- Asset Portfolio Holdings table (all vaults with share balances)
- Recent Ledger Event Activity (last 50 events involving the wallet)

---

## Transaction Data Captured

Every indexed transaction stores all of the following:

| Field | Description | Example |
|-------|-------------|---------|
| `txHash` | Transaction hash | `0x38b857...3521` |
| `blockNumber` | Block number | `11115365` |
| `fromAddress` | Sender address (lowercase) | `0x5537db...83` |
| `toAddress` | Recipient address (lowercase) | `0x6eda73...a4` |
| `contractAddress` | If contract creation, the deployed address | `null` |
| `method` | First 4 bytes of calldata (method selector) | `0x6e553f65` |
| `status` | Execution result | `SUCCESS` / `REVERTED` |
| `value` | Native ETH value in Wei | `10000000000000000` |
| `gasUsed` | Actual gas consumed | `21000` |
| `gasLimit` | Gas limit set by sender | `50000` |
| `gasPrice` | Effective gas price in Wei | `1500000000` |
| `transactionFee` | Total fee = gasUsed × gasPrice (Wei, as string) | `31500000000000` |
| `tokenName` | Token/vault name if a transfer event was detected | `E2E Test Vault 49` |
| `tokenSymbol` | Token symbol | `E2E-V49` |
| `tokenAmount` | Raw token amount (in base units) | `1000000000000000000` |
| `timestamp` | Block timestamp | `2026-06-22T12:54:39Z` |

---

## Vault & Asset Tracking

### Dynamic Vault Discovery
When a `VaultCreated` event is decoded from the `VaultFactory` contract:
1. The new vault address is extracted from the event payload
2. The appropriate ABI (`SyncVaultABI` or `AsyncVaultABI`) is registered into the in-memory decoder registry
3. All future blocks will automatically decode events from that vault address
4. The vault is stored in the `vaults` table as a read-model record

### TVL & Share Tracking
The `vaultProjection.js` listens to:
- `Deposit` → increments `tvl` and `totalShares` on the vault record
- `Withdraw` → decrements `tvl` and `totalShares`
- `Transfer` → no TVL change (share redistribution)

### Token Holder Leaderboard
The `portfolio_positions` table tracks per-wallet per-vault shares.  
The `token_holders` table tracks per-token per-wallet raw balance for all ERC-20 tokens (USDC, USDT, vault shares).

---

## Investor & Identity Details

When rendering the **Asset Details** holder leaderboard, the API enriches each token holder entry by querying the canonical `blockchain_events` ledger for `IdentityRegistered` events:

```
IdentityRegistry.IdentityRegistered(wallet, tokenId, role, jurisdiction)
```

| Role Code | Label |
|-----------|-------|
| `0` | Retail |
| `1` | Accredited |
| `2` | Institutional |
| `3` | Regulator |

If a wallet has an `IdentityRegistered` event in the ledger:
- **KYC Status**: Verified ✅
- **Role**: Decoded from numeric code
- **Jurisdiction**: Country code integer from event payload

If no identity event exists for the holder's address:
- **KYC Status**: Unverified ⬜
- **Role**: Retail (default)
- **Jurisdiction**: Unknown

---

## Chain Reorganization Handling

The real-time sync loop detects reorgs by comparing `parentHash` values:

```
new_block.parentHash !== stored_previous_block.blockHash
→ REORG DETECTED
```

On reorg:
1. Walk backwards from the reorged block to find the common ancestor
2. Delete all `IndexedBlock` records past the ancestor
3. Mark all `BlockchainEvent` records past the ancestor as `status: 'reorg_removed'`, `isRemoved: true`
4. Reset all `ProjectionState` pointers to `lastEventId: 0`
5. Clear all read model tables (portfolio positions, vaults, fees, etc.)
6. The projection worker automatically rebuilds from scratch from the canonical ledger

---

## Running the Indexer

### Prerequisites
- Node.js 18+
- MySQL database
- Alchemy RPC URL (Sepolia)

### Environment Variables (`.env`)
```env
DATABASE_URL="mysql://user:password@localhost:3306/crats_indexer"
RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY"
CHAIN_ID=11155111
START_BLOCK=11115300
PORT=5001

# Static Contract Addresses
IDENTITY_REGISTRY=0xA8605BBF965973f324C3f51F4d7121900d7F732D
IDENTITY_SBT=0x5e88d8a83dE2F46F6809BaA06299f5113f3607A7
KYC_REGISTRY=0xb4C0CD81eA49Dc4AC94472004955C7EE9f99Dc5c
# ... (all 23 contracts)
USDC=0x...
USDT=0x...
```

### Commands

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run historical backfill (resumes automatically if stopped)
npm run backfill

# Start real-time indexer + API server
npm start

# Start in dev mode with hot reload
npm run dev

# Replay all projections from scratch
npm run replay -- --all

# Replay a single projection
npm run replay -- --projection=portfolio

# Open Prisma Studio (DB GUI)
npm run prisma:studio
```

### PM2 Production Deployment (`ecosystem.config.js`)
```bash
pm2 start ecosystem.config.js
pm2 logs crats-indexer
pm2 status
```

### Service Ports
| Service | Port |
|---------|------|
| REST API + Explorer UI | `5001` |
| Prisma Studio | `5555` |

---

## Summary of What Gets Indexed

```
Per Block  →  Block header (number, hash, parentHash, timestamp, gasUsed, txCount)
Per TX     →  Full transaction details including:
                - Sender, receiver, method selector
                - Native ETH value
                - Gas limit, gas used, gas price
                - Total gas fee (gasUsed × gasPrice in Wei)
                - Token name, symbol, and amount if a token transfer was detected
Per Log    →  Raw log: address, topics, data (LONGTEXT)
Per Event  →  Decoded event: name, contract, payload (JSON), block info
```

Over **286,000+ transactions**, **1.3M+ logs**, and **1,113 blocks** have been indexed from Sepolia covering the full CRATS Protocol deployment history from block `11115300` to `11116413`.

---

*Built by the COPYm Engineering Team · CRATS Protocol v3.0 · June 2026*
