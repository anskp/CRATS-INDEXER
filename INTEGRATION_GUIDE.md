# CRATS Indexer — Backend Integration Guide

> **For**: COPYm Backend Developers  
> **Indexer Base URL**: `http://localhost:5001` (dev) · `http://<indexer-host>:5001` (prod)  
> **Protocol**: HTTP/1.1 REST · JSON responses  
> **Auth**: None (internal service — secure via network/firewall, not token)  
> **All BigInt values** (block numbers, gas, balances) are returned as **strings** to avoid JS precision loss.

---

## Table of Contents

1. [Quick Start — Test the Connection](#1-quick-start--test-the-connection)
2. [Architecture: How the Indexer Fits In](#2-architecture-how-the-indexer-fits-in)
3. [Common Use Cases & Which Endpoints to Call](#3-common-use-cases--which-endpoints-to-call)
4. [Full API Reference with Response Shapes](#4-full-api-reference-with-response-shapes)
   - [Health & Sync Status](#health--sync-status)
   - [Vaults](#vaults)
   - [Portfolio & Wallet](#portfolio--wallet)
   - [Protocol Metrics](#protocol-metrics)
   - [Explorer: Blocks](#explorer-blocks)
   - [Explorer: Transactions](#explorer-transactions)
   - [Explorer: Contracts](#explorer-contracts)
   - [Explorer: Assets & Token Holders](#explorer-assets--token-holders)
   - [Audit & Event Trail](#audit--event-trail)
5. [Error Handling](#5-error-handling)
6. [Important Data Notes](#6-important-data-notes)
7. [Example: Node.js / TypeScript Integration](#7-example-nodejs--typescript-integration)
8. [Example: Python Integration](#8-example-python-integration)
9. [Polling Strategy & Caching Advice](#9-polling-strategy--caching-advice)
10. [What NOT to do](#10-what-not-to-do)

---

## 1. Quick Start — Test the Connection

Run these from your terminal to verify the indexer is reachable:

```bash
# Health check
curl http://localhost:5001/health

# Protocol TVL
curl http://localhost:5001/protocol/tvl

# List all vaults
curl http://localhost:5001/vaults

# Get a specific wallet's portfolio
curl http://localhost:5001/portfolio/0xYOURWALLETADDRESS

# Sync progress
curl http://localhost:5001/api/sync-status
```

Expected health response:
```json
{
  "status": "UP",
  "timestamp": "2026-06-22T17:35:00.000Z",
  "chainHead": 11117500,
  "currentIndexed": 11117499,
  "syncLag": 1,
  "databaseConnected": true
}
```

If you get `status: "DOWN"`, the MySQL database or RPC connection is broken.

---

## 2. Architecture: How the Indexer Fits In

```
                        ┌─────────────────────────────────────┐
                        │         ETHEREUM SEPOLIA             │
                        │     (Smart Contracts on-chain)       │
                        └────────────────┬────────────────────┘
                                         │  Alchemy RPC (WebSocket + HTTP)
                                         ▼
                        ┌─────────────────────────────────────┐
                        │         CRATS INDEXER               │
                        │  ┌──────────┐  ┌─────────────────┐ │
                        │  │blockSync │  │ backfill.js     │ │
                        │  │(realtime)│  │ (one-time sync) │ │
                        │  └────┬─────┘  └────────┬────────┘ │
                        │       │                  │          │
                        │  ┌────▼──────────────────▼──────┐  │
                        │  │     MySQL Database             │  │
                        │  │  blockchain_events (ledger)   │  │
                        │  │  blocks, transactions, logs   │  │
                        │  │  vaults, portfolio_positions  │  │
                        │  │  token_holders, fee_records   │  │
                        │  └────────────────┬─────────────┘  │
                        │                   │                 │
                        │  ┌────────────────▼─────────────┐  │
                        │  │   REST API (Express :5001)    │  │
                        │  └────────────────┬─────────────┘  │
                        └───────────────────┼─────────────────┘
                                            │  HTTP REST (JSON)
                         ┌──────────────────┼────────────────┐
                         │                  │                 │
                    ┌────▼─────┐    ┌───────▼──────┐  ┌──────▼───────┐
                    │ COPYm    │    │ COPYm Mobile │  │ CRATS Explorer│
                    │ Backend  │    │    App       │  │   UI (built-in│
                    │ (NestJS/ │    │  (Flutter/   │  │   /dashboard) │
                    │ Express) │    │  React Native│  └──────────────┘
                    └──────────┘    └──────────────┘
```

### Key Principle for Backend Developers

> **Never query the blockchain directly for read operations.**  
> All historical and current state is already in the indexer's MySQL database, exposed via REST API.  
> Only use direct RPC calls for **write operations** (sending transactions).

The indexer is the **single source of truth** for:
- All on-chain events (decoded and raw)
- Vault TVL and share balances
- Investor portfolio positions
- Token holder leaderboards
- Transaction history with gas fees
- KYC/Identity registration events

---

## 3. Common Use Cases & Which Endpoints to Call

| What your backend needs | Endpoint to call |
|------------------------|-----------------|
| Show investor's vault positions | `GET /portfolio/:wallet` |
| Show investor's full transaction history | `GET /portfolio/:wallet/history` |
| Get vault TVL and share price | `GET /vaults/:id/statistics` |
| List all available vaults | `GET /vaults` |
| Get total protocol TVL | `GET /protocol/tvl` |
| Get total fees earned by protocol | `GET /protocol/fees` |
| Get top investors in a vault (leaderboard) | `GET /api/assets/:vaultAddress` |
| Verify if a transaction was confirmed | `GET /api/transactions/:hash` |
| Get all events for a vault (audit trail) | `GET /audit/vault/:vaultAddress` |
| Get all events for an investor (audit trail) | `GET /audit/portfolio/:wallet` |
| Check indexer health before serving data | `GET /health` |
| Check sync lag before showing "live" data | `GET /api/sync-status` |
| Get all fee records for a vault | `GET /protocol/fees` |
| Get NAV history / oracle submissions | (query `nav_submissions` via `/audit/vault`) |
| Search by tx hash / block / address | `GET /api/search?q=` |

---

## 4. Full API Reference with Response Shapes

All addresses in requests are case-insensitive (lowercased internally).  
All BigInt fields (marked with `// BigInt as string`) are returned as decimal strings.

---

### Health & Sync Status

#### `GET /health`
Use before serving any time-sensitive data. If `syncLag > 50`, the indexer may be catching up.

```json
{
  "status": "UP",
  "timestamp": "2026-06-22T17:35:00.000Z",
  "chainHead": 11117500,        // Latest Sepolia block
  "currentIndexed": 11117499,   // Last block indexer has processed
  "syncLag": 1,                 // Blocks behind (0 = fully synced)
  "databaseConnected": true
}
```

#### `GET /api/sync-status`
Detailed sync metrics for dashboard displays.

```json
{
  "currentBlock": "11117499",       // BigInt as string
  "latestBlock": "11117500",        // BigInt as string
  "progressPercentage": "99.99",
  "eventsProcessed": 8,
  "transactionsIndexed": 286309,
  "databaseRecords": {
    "blocks": 1180,
    "transactions": 286309,
    "failedBlocks": 0,
    "events": 8
  },
  "status": "completed",           // idle | syncing | completed | error
  "updatedAt": "2026-06-22T17:35:00.000Z"
}
```

---

### Vaults

#### `GET /vaults`
Returns all discovered vaults (dynamically created via VaultFactory).

```json
[
  {
    "id": 1,
    "vaultAddress": "0x6eda73cddfeca93d558ddcb60c5414f9fe24c6a4",
    "assetAddress": "0xf3f6f980917e9304d8dc9828a463bdf4b59239d4",
    "name": "E2E Test Vault 49",
    "symbol": "E2E-V49",
    "category": "REAL_ESTATE",
    "vaultType": "SYNC",           // SYNC | ASYNC
    "creator": "0x5537dbc19eee936a615b151c8c5983fbf735c583",
    "tvl": "0",                    // BigInt as string (raw USDC units)
    "totalShares": "0",            // BigInt as string
    "active": true,
    "createdAt": "2026-06-22T12:54:39.226Z",
    "updatedAt": "2026-06-22T12:54:39.226Z"
  }
]
```

#### `GET /vaults/:id`
Single vault by address.  
`:id` = vault contract address (e.g., `0x6eda73cd...`)

Same shape as array item above.  
Returns `404 { "error": "Vault not found" }` if not in database yet.

#### `GET /vaults/:id/statistics`
Clean financial summary for displaying vault stats on a dashboard.

```json
{
  "vaultAddress": "0x6eda73cddfeca93d558ddcb60c5414f9fe24c6a4",
  "tvl": "1000000000",          // Total value locked in base units (e.g., USDC 6 decimals)
  "totalShares": "950000000",   // Total shares outstanding
  "aumUSD": "1000000000",       // AUM in USD (same as TVL for USDC vaults)
  "sharePrice": "1.052631...",  // tvl / totalShares
  "active": true
}
```

> **Note on decimals**: USDC/USDT use 6 decimals. Divide by `10^6` to get human-readable USD. Vault shares use 18 decimals — divide by `10^18`.

---

### Portfolio & Wallet

#### `GET /portfolio/:wallet`
Returns all vault positions for a wallet. Use this for the **investor portfolio screen**.

`:wallet` = investor's Ethereum address

```json
[
  {
    "id": 12,
    "walletAddress": "0x5537dbc19eee936a615b151c8c5983fbf735c583",
    "vaultAddress": "0x6eda73cddfeca93d558ddcb60c5414f9fe24c6a4",
    "shares": "1000000000000000000",  // Raw shares (18 decimals)
    "lastUpdatedBlock": "11115432",   // BigInt as string
    "updatedAt": "2026-06-22T13:00:00.000Z"
  }
]
```

#### `GET /portfolio/:wallet/history`
Returns last 100 relevant decoded events for a wallet (Deposits, Withdraws, Transfers, etc).

```json
[
  {
    "eventId": "5",                    // BigInt as string
    "chainId": 11155111,
    "blockNumber": "11115365",         // BigInt as string
    "blockHash": "0xabc...",
    "parentHash": "0xdef...",
    "txHash": "0x38b857...",
    "logIndex": 250,
    "contractAddress": "0x6eda73cd...",
    "eventName": "VaultCreated",
    "eventVersion": "1.0",
    "eventPayload": {                  // Decoded event args (structure varies per event)
      "vault": "0x6eda73cd...",
      "asset": "0xf3f6f9...",
      "vaultType": "0",
      "name": "E2E Test Vault 49",
      "symbol": "E2E-V49",
      "category": "REAL_ESTATE",
      "creator": "0x5537db..."
    },
    "isRemoved": false,                // true = affected by chain reorg
    "status": "processed",
    "createdAt": "2026-06-22T12:54:39.226Z"
  }
]
```

#### `GET /api/wallets/:address`
Rich wallet profile — use for the **investor detail page** in backend-rendered views or mobile.

```json
{
  "walletAddress": "0x5537dbc19eee936a615b151c8c5983fbf735c583",
  "assetsOwned": 2,              // Number of unique vaults/tokens with non-zero balance
  "vaultDeposits": 5,            // Count of Deposit events
  "vaultWithdrawals": 1,         // Count of Withdraw events
  "transactionsCount": 143,      // Total on-chain transactions sent or received
  "portfolioValue": 2000.5,      // Sum of share balances (raw, not USD-converted)
  "positions": [                 // Same as /portfolio/:wallet
    {
      "id": 12,
      "walletAddress": "0x5537...",
      "vaultAddress": "0x6eda...",
      "shares": "1000000000000000000",
      "lastUpdatedBlock": "11115432",
      "updatedAt": "2026-06-22T13:00:00.000Z"
    }
  ],
  "recentEvents": [              // Last 50 events involving this wallet (same shape as /portfolio/:wallet/history)
    { ... }
  ]
}
```

---

### Protocol Metrics

#### `GET /protocol/tvl`
Aggregate TVL across all vaults. Cached for 3 seconds.

```json
{
  "tvl": "5000000000",        // Total protocol TVL in base units
  "timestamp": "2026-06-22T17:35:00.000Z"
}
```

#### `GET /protocol/fees`
Total fees collected by the protocol. Cached for 3 seconds.

```json
{
  "totalFeesAccrued": "150000000",    // Base units
  "recentFeeDistributions": [
    {
      "id": 1,
      "vaultAddress": "0x6eda73...",
      "feeType": "mgmt",              // mgmt | perf | entry | exit | trading
      "amount": "5000000",
      "recipient": "0xTREASURY...",
      "txHash": "0x38b857...",
      "blockNumber": "11115400",
      "timestamp": "2026-06-22T13:00:00.000Z"
    }
  ]
}
```

#### `GET /protocol/analytics`
High-level protocol snapshot. Cached for 3 seconds.

```json
{
  "tvl": "5000000000",
  "totalFees": "150000000",
  "activeVaultsCount": 3,
  "timestamp": "2026-06-22T17:35:00.000Z"
}
```

---

### Explorer: Blocks

#### `GET /api/blocks?page=1&limit=10`
Paginated blocks list.

```json
{
  "data": [
    {
      "blockNumber": "11117499",
      "blockHash": "0xabc123...",
      "parentHash": "0xdef456...",
      "timestamp": "2026-06-22T17:34:48.000Z",
      "gasUsed": "15000000",
      "txCount": 243
    }
  ],
  "total": 1180,
  "page": 1,
  "limit": 10
}
```

#### `GET /api/blocks/:number`
Single block with all its transactions.

```json
{
  "blockNumber": "11115365",
  "blockHash": "0x...",
  "parentHash": "0x...",
  "timestamp": "2026-06-22T12:54:39.000Z",
  "gasUsed": "15132900",
  "txCount": 3,
  "transactions": [
    {
      "txHash": "0x38b857...",
      "blockNumber": "11115365",
      "fromAddress": "0x5537db...",
      "toAddress": "0x6eda73...",
      "contractAddress": null,
      "method": "0x6e553f65",
      "status": "SUCCESS",
      "gasUsed": "87000",
      "gasLimit": "120000",
      "value": "0",
      "gasPrice": "1500000000",
      "transactionFee": "130500000000000",
      "tokenName": "E2E Test Vault 49",
      "tokenSymbol": "E2E-V49",
      "tokenAmount": "1000000000000000000",
      "timestamp": "2026-06-22T12:54:39.000Z"
    }
  ]
}
```

---

### Explorer: Transactions

#### `GET /api/transactions?page=1&limit=10`
Paginated transaction list.

```json
{
  "data": [
    {
      "txHash": "0x38b857...",
      "blockNumber": "11115365",
      "fromAddress": "0x5537db...",
      "toAddress": "0x6eda73...",
      "contractAddress": null,
      "method": "0x6e553f65",
      "status": "SUCCESS",           // SUCCESS | REVERTED
      "gasUsed": "87000",
      "gasLimit": "120000",
      "value": "0",                  // Native ETH value in Wei
      "gasPrice": "1500000000",      // Wei per gas unit
      "transactionFee": "130500000000000", // gasUsed * gasPrice in Wei
      "tokenName": "E2E Test Vault 49",    // null if no token event detected
      "tokenSymbol": "E2E-V49",            // null if no token event detected
      "tokenAmount": "1000000000000000000",// null if no token event detected
      "timestamp": "2026-06-22T12:54:39.000Z"
    }
  ],
  "total": 286309,
  "page": 1,
  "limit": 10
}
```

#### `GET /api/transactions/:hash`
Full transaction detail with all emitted logs.

```json
{
  "txHash": "0x38b857...",
  "blockNumber": "11115365",
  "fromAddress": "0x5537db...",
  "toAddress": "0x6eda73...",
  "contractAddress": null,
  "method": "0x6e553f65",
  "status": "SUCCESS",
  "gasUsed": "87000",
  "gasLimit": "120000",
  "value": "0",
  "gasPrice": "1500000000",
  "transactionFee": "130500000000000",
  "tokenName": "E2E Test Vault 49",
  "tokenSymbol": "E2E-V49",
  "tokenAmount": "1000000000000000000",
  "timestamp": "2026-06-22T12:54:39.000Z",
  "logs": [
    {
      "id": 44001,
      "txHash": "0x38b857...",
      "logIndex": 0,
      "address": "0x6eda73...",
      "topics": "[\"0xdcbc...\",\"0x00000...5537db\"]",  // JSON array string
      "data": "0x0000000....",                            // Raw hex data
      "blockNumber": "11115365"
    }
  ]
}
```

> **Tip**: `topics` is a JSON-encoded string. Parse with `JSON.parse(log.topics)`.

---

### Explorer: Contracts

#### `GET /api/contracts`
All tracked contracts (23 static + all dynamic vault clones).

```json
[
  { "name": "IdentityRegistry", "address": "0xA8605BBF...", "type": "Static System" },
  { "name": "AssetFactory",     "address": "0xeCd44390...", "type": "Static Factory" },
  { "name": "USDC",             "address": "0x...",         "type": "Static ERC-20 Token" },
  { "name": "E2E Test Vault 49 (E2E-V49)", "address": "0x6eda73...", "type": "Dynamic Vault (SYNC)" }
]
```

#### `GET /api/contracts/:address`
Contract detail with recent decoded events.

```json
{
  "contractAddress": "0x6eda73...",
  "name": "E2E Test Vault 49",
  "contractType": "Dynamic Vault (SYNC)",
  "totalTransactions": 45,
  "lastActivity": "2026-06-22T17:00:00.000Z",
  "recentEvents": [
    {
      "eventId": "8",
      "eventName": "VaultCreated",
      "blockNumber": "11115365",
      "txHash": "0x38b857...",
      "eventPayload": { ... },
      ...
    }
  ]
}
```

---

### Explorer: Assets & Token Holders

#### `GET /api/assets`
All tokenized assets with active holder counts. Includes USDC, USDT, and all vaults.

```json
[
  { "id": "0x..usdc..", "name": "USD Coin",       "symbol": "USDC",    "holdersCount": 0 },
  { "id": "0x..usdt..", "name": "Tether USD",     "symbol": "USDT",    "holdersCount": 0 },
  { "id": "0x6eda73..", "name": "E2E Test Vault 49", "symbol": "E2E-V49", "holdersCount": 2 }
]
```

#### `GET /api/assets/:id`
Detailed asset page with **enriched investor leaderboard**.

`:id` = token contract address (vault address or USDC/USDT address)

```json
{
  "id": "0x6eda73...",
  "name": "E2E Test Vault 49",
  "symbol": "E2E-V49",
  "totalSupply": "5000000000000000000000",   // Raw shares (18 decimals)
  "holdersCount": 2,
  "holders": [
    {
      "id": 1,
      "tokenAddress": "0x6eda73...",
      "holderAddress": "0x5537db...",
      "balance": "3000000000000000000000",    // Raw balance (18 decimals)
      "updatedAt": "2026-06-22T13:00:00.000Z",
      // Enriched from IdentityRegistered ledger event:
      "kycVerified": true,
      "tokenId": "1",           // SBT token ID
      "role": "Accredited",     // Retail | Accredited | Institutional | Regulator
      "jurisdiction": "840"     // ISO 3166-1 numeric country code (840 = USA)
    },
    {
      "holderAddress": "0xabcdef...",
      "balance": "2000000000000000000000",
      "kycVerified": false,
      "tokenId": "N/A",
      "role": "Retail",
      "jurisdiction": "Unknown"
    }
  ],
  "transfers": [
    {
      "eventId": "7",
      "eventName": "Deposit",
      "blockNumber": "11115400",
      "txHash": "0xabc...",
      "eventPayload": {
        "caller": "0x5537...",
        "owner": "0x5537...",
        "assets": "1000000",
        "shares": "1000000000000000000"
      }
    }
  ]
}
```

---

### Audit & Event Trail

These are the most important endpoints for **compliance** and **regulatory audit**.

#### `GET /audit/event/:txHash`
All decoded events emitted in a single transaction.

```json
[
  {
    "eventId": "5",
    "eventName": "VaultCreated",
    "contractAddress": "0xeCd44390...",
    "blockNumber": "11115365",
    "txHash": "0x38b857...",
    "eventPayload": { ... },
    "isRemoved": false,
    "status": "processed"
  }
]
```

#### `GET /audit/portfolio/:wallet`
Full chronological event history for a wallet — only Deposit, Withdraw, Transfer events.  
Ordered oldest → newest (for replay/reconciliation).

```json
[
  {
    "eventId": "3",
    "eventName": "Deposit",
    "contractAddress": "0x6eda73...",
    "blockNumber": "11115400",
    "txHash": "0xabc...",
    "eventPayload": {
      "caller": "0x5537...",
      "owner": "0x5537...",
      "assets": "1000000",       // USDC deposited (6 decimals)
      "shares": "950000000000000000"  // Shares minted (18 decimals)
    },
    "isRemoved": false,
    "status": "processed"
  }
]
```

#### `GET /audit/vault/:id`
All events ever emitted by or related to a vault address.  
Ordered oldest → newest.

Same response shape as above, but covers all event types (VaultCreated, Deposit, Withdraw, FeeCharged, etc.)

---

### Search

#### `GET /api/search?q={query}`
Universal search. Returns a redirect URL for the explorer.

| Query format | Detected as | Redirect |
|-------------|-------------|---------|
| All digits (`11115365`) | Block number | `/block.html?number=11115365` |
| 66-char hex (`0x...`) | Transaction hash | `/transaction.html?hash=0x...` |
| 42-char hex in contract list | Contract address | `/contract.html?address=0x...` |
| 42-char hex not in contracts | Wallet address | `/wallet.html?address=0x...` |
| Vault symbol (`E2E-V49`) | Asset | `/asset.html?id=0x6eda73...` |

```json
{
  "type": "wallet",
  "redirectUrl": "/wallet.html?address=0x5537dbc19eee936a615b151c8c5983fbf735c583"
}
```

Returns `404` if not found.

---

## 5. Error Handling

All endpoints return errors in this format:

```json
{ "error": "Vault not found" }
```

| HTTP Status | Meaning |
|------------|---------|
| `200` | Success |
| `404` | Record not found in indexer database |
| `400` | Bad query parameter (e.g., empty search) |
| `500` | Internal error (DB connection issue, etc.) |

**Always check the indexer health** before presenting data to users if freshness matters:

```javascript
const health = await fetch('/health').then(r => r.json());
if (health.syncLag > 100) {
  // Show stale data warning to user
}
```

---

## 6. Important Data Notes

### BigInt / Number precision
All `BigInt` values are returned as **decimal strings**. Convert with `BigInt(value)` in JS or `int(value)` in Python. Never use `parseInt()` on them — JS loses precision above 2^53.

```javascript
// ✅ Correct
const shares = BigInt(position.shares);
const humanReadable = Number(shares) / 1e18;

// ❌ Wrong — loses precision for large numbers
const shares = parseInt(position.shares);
```

### Addresses are lowercase
All addresses stored and returned are **lowercase**. Always `.toLowerCase()` before comparing.

### `isRemoved: true` = chain reorg
If `isRemoved` is `true` on a `BlockchainEvent`, that event was part of a forked chain and is **not canonical**. Always filter `isRemoved: false` when building financial state.

### Token decimals
| Token | Decimals | Divide by |
|-------|---------|----------|
| USDC | 6 | `10^6` = `1_000_000` |
| USDT | 6 | `10^6` = `1_000_000` |
| Vault shares | 18 | `10^18` = `1_000_000_000_000_000_000` |
| Native ETH | 18 | `10^18` |
| Gas price / fee | 18 → Gwei | `/ 10^9` for Gwei, `/ 10^18` for ETH |

### `transactionFee` = real gas cost
```
transactionFee (Wei) = gasUsed × gasPrice
ETH cost = transactionFee / 10^18
```

### `eventPayload` structure varies per event
The `eventPayload` JSON structure depends on which event was emitted. Common patterns:

| Event | Key fields in payload |
|-------|----------------------|
| `Deposit` | `caller`, `owner`, `assets`, `shares` |
| `Withdraw` | `caller`, `receiver`, `owner`, `assets`, `shares` |
| `Transfer` | `from`, `to`, `value` |
| `VaultCreated` | `vault`, `asset`, `vaultType`, `name`, `symbol`, `creator` |
| `IdentityRegistered` | `wallet`, `tokenId`, `role`, `jurisdiction` |
| `FeeCharged` | `feeType`, `amount`, `recipient` |

---

## 7. Example: Node.js / TypeScript Integration

### Setup

```typescript
// indexer.client.ts
const INDEXER_URL = process.env.INDEXER_URL || 'http://localhost:5001';

async function indexerFetch(path: string) {
  const res = await fetch(`${INDEXER_URL}${path}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Indexer error [${res.status}]: ${err.error}`);
  }
  return res.json();
}

export const indexer = {
  // Health
  health: () => indexerFetch('/health'),
  syncStatus: () => indexerFetch('/api/sync-status'),

  // Vaults
  vaults: () => indexerFetch('/vaults'),
  vault: (id: string) => indexerFetch(`/vaults/${id}`),
  vaultStats: (id: string) => indexerFetch(`/vaults/${id}/statistics`),

  // Portfolio
  portfolio: (wallet: string) => indexerFetch(`/portfolio/${wallet}`),
  portfolioHistory: (wallet: string) => indexerFetch(`/portfolio/${wallet}/history`),
  walletProfile: (address: string) => indexerFetch(`/api/wallets/${address}`),

  // Protocol
  tvl: () => indexerFetch('/protocol/tvl'),
  fees: () => indexerFetch('/protocol/fees'),
  analytics: () => indexerFetch('/protocol/analytics'),

  // Assets & Leaderboard
  assets: () => indexerFetch('/api/assets'),
  assetDetail: (id: string) => indexerFetch(`/api/assets/${id}`),

  // Explorer
  transaction: (hash: string) => indexerFetch(`/api/transactions/${hash}`),

  // Audit
  auditVault: (id: string) => indexerFetch(`/audit/vault/${id}`),
  auditPortfolio: (wallet: string) => indexerFetch(`/audit/portfolio/${wallet}`),
};
```

### Usage examples

```typescript
// 1. Get investor portfolio for a dashboard
const positions = await indexer.portfolio('0x5537dbc19eee936a615b151c8c5983fbf735c583');
for (const pos of positions) {
  const sharesHuman = Number(BigInt(pos.shares)) / 1e18;
  console.log(`Vault: ${pos.vaultAddress} — Shares: ${sharesHuman.toFixed(4)}`);
}

// 2. Get vault TVL for a product card
const stats = await indexer.vaultStats('0x6eda73cddfeca93d558ddcb60c5414f9fe24c6a4');
const tvlUSD = Number(BigInt(stats.tvl)) / 1e6; // USDC is 6 decimals
console.log(`TVL: $${tvlUSD.toLocaleString()}`);

// 3. Check if a submitted transaction was confirmed
const txHash = '0x38b857159b37d04d6e7e1e5f720a24efcf68e1807096535fe607bd6e054b3521';
try {
  const tx = await indexer.transaction(txHash);
  console.log(`Status: ${tx.status}`);         // SUCCESS | REVERTED
  console.log(`Gas fee: ${Number(BigInt(tx.transactionFee)) / 1e18} ETH`);
  console.log(`Token: ${tx.tokenName} — Amount: ${Number(BigInt(tx.tokenAmount || '0')) / 1e18}`);
} catch (e) {
  // 404 = not yet indexed, retry after a few seconds
  console.log('Transaction not yet indexed, retry...');
}

// 4. Get top investors in a vault (for leaderboard widget)
const asset = await indexer.assetDetail('0x6eda73cddfeca93d558ddcb60c5414f9fe24c6a4');
const leaderboard = asset.holders.map(h => ({
  address: h.holderAddress,
  balance: (Number(BigInt(h.balance)) / 1e18).toFixed(2),
  kyc: h.kycVerified ? '✅ Verified' : '⬜ Unverified',
  role: h.role,
  country: h.jurisdiction,
}));
console.table(leaderboard);

// 5. Get full audit trail for compliance report
const trail = await indexer.auditPortfolio('0x5537dbc19eee936a615b151c8c5983fbf735c583');
const deposits = trail.filter(e => e.eventName === 'Deposit');
const totalDeposited = deposits.reduce((acc, e) => {
  const payload = typeof e.eventPayload === 'string' ? JSON.parse(e.eventPayload) : e.eventPayload;
  return acc + BigInt(payload.assets || '0');
}, 0n);
console.log(`Total deposited: ${Number(totalDeposited) / 1e6} USDC`);
```

---

## 8. Example: Python Integration

```python
import requests
from decimal import Decimal

INDEXER_URL = "http://localhost:5001"

def indexer_get(path):
    res = requests.get(f"{INDEXER_URL}{path}")
    res.raise_for_status()
    return res.json()

# Get all vaults
vaults = indexer_get("/vaults")
for v in vaults:
    print(f"Vault: {v['name']} ({v['symbol']}) — TVL: {int(v['tvl']) / 1e6:.2f} USDC")

# Get investor portfolio
wallet = "0x5537dbc19eee936a615b151c8c5983fbf735c583"
positions = indexer_get(f"/portfolio/{wallet}")
for pos in positions:
    shares_human = int(pos["shares"]) / 1e18
    print(f"Vault {pos['vaultAddress']}: {shares_human:.4f} shares")

# Get protocol TVL
tvl_data = indexer_get("/protocol/tvl")
tvl_usd = int(tvl_data["tvl"]) / 1e6
print(f"Protocol TVL: ${tvl_usd:,.2f} USD")

# Verify a transaction
tx_hash = "0x38b857159b37d04d6e7e1e5f720a24efcf68e1807096535fe607bd6e054b3521"
try:
    tx = indexer_get(f"/api/transactions/{tx_hash}")
    fee_eth = int(tx["transactionFee"]) / 1e18
    print(f"Tx {tx['status']} — Fee: {fee_eth:.8f} ETH")
    if tx.get("tokenName"):
        amount = int(tx["tokenAmount"]) / 1e18
        print(f"Token: {tx['tokenName']} ({tx['tokenSymbol']}) — Amount: {amount:.4f}")
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 404:
        print("Transaction not yet indexed")
```

---

## 9. Polling Strategy & Caching Advice

### For time-sensitive data (user-facing dashboards)
```
Poll /health every 30 seconds → cache syncLag
Poll /protocol/tvl every 5 seconds (already cached 3s in indexer)
Poll /portfolio/:wallet every 10 seconds after user action (deposit/withdraw)
```

### For after a user submits a transaction
```javascript
// Poll until confirmed
async function waitForTx(hash, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const tx = await indexer.transaction(hash);
      return tx; // Confirmed!
    } catch {
      // Not yet indexed — wait 3 seconds
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('Transaction not confirmed within 90 seconds');
}
```

### For static / rarely changing data
Cache these for 60+ seconds in your backend:
- `/vaults` — new vaults are rare
- `/api/contracts` — never changes
- `/api/assets` — changes only when new vault is created

### Do NOT poll rapidly
The indexer has no rate limiting, but hammering it with sub-second requests defeats the purpose. The indexer updates on each new block (~12 seconds on Sepolia).

---

## 10. What NOT to do

| ❌ Don't | ✅ Do instead |
|---------|--------------|
| Query the blockchain RPC directly for reads | Use indexer REST API |
| Call `parseInt()` on BigInt string fields | Use `BigInt(value)` |
| Compare addresses without lowercasing | Always `.toLowerCase()` both sides |
| Include `isRemoved: true` events in financial calculations | Filter `isRemoved === false` |
| Store raw `shares` as JavaScript `number` | Store as `string`, convert to `BigInt` when computing |
| Assume the indexer is always 100% synced | Check `syncLag` from `/health` before critical reads |
| Use `/api/search` for backend lookups | Use direct endpoints (`/vaults/:id`, `/portfolio/:wallet`) |
| Trust `portfolioValue` from `/api/wallets` as USD | It's raw share sum — convert with vault share price |

---

## Quick Reference Card

```
BASE URL: http://localhost:5001

── INVESTOR FEATURES ─────────────────────────────────
GET /portfolio/:wallet              → vault share positions
GET /portfolio/:wallet/history      → event history (last 100)
GET /api/wallets/:address           → full wallet profile

── VAULT DATA ────────────────────────────────────────
GET /vaults                         → all vaults list
GET /vaults/:id                     → single vault
GET /vaults/:id/statistics          → TVL, sharePrice, AUM

── PROTOCOL METRICS ──────────────────────────────────
GET /protocol/tvl                   → total TVL
GET /protocol/fees                  → fees accrued
GET /protocol/analytics             → TVL + fees + vault count

── COMPLIANCE / AUDIT ────────────────────────────────
GET /audit/vault/:id                → all vault events (asc)
GET /audit/portfolio/:wallet        → investor deposit/withdraw trail
GET /audit/event/:txHash            → all events in a tx

── EXPLORER ──────────────────────────────────────────
GET /api/transactions/:hash         → tx detail + gas + token + logs
GET /api/assets/:id                 → holders leaderboard + KYC
GET /api/blocks/:number             → block + all transactions

── HEALTH ────────────────────────────────────────────
GET /health                         → sync lag + db status
GET /api/sync-status                → detailed sync metrics
```

---

*COPYm Engineering — CRATS Protocol v3.0 — June 2026*
