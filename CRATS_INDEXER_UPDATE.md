# CRATS Protocol Production Indexer (`crats-indexer`) — Full Specification & Release Update v2.0.0

> **Official Release Specification** | Version: `v2.0.0` | Date: July 21, 2026  
> **Repository Location**: `crats-indexer` | **Target Network**: Ethereum Sepolia (`chainId: 11155111`)

---

## 1. Executive Summary

**CRATS Protocol Indexer (`crats-indexer`)** is the high-performance, real-time blockchain indexing and event-sourcing engine for the **CRATS EVM Protocol v10.1.0**. 

The indexer captures **every inch of data**, price attestations, vault yield calculations, fee accruals, DMS document SHA-256 hashes, carbon credit batch vintages, compliance restrictions, physical redemptions, cross-border VASP travel rule logs, and secondary P2P beneficial ownership register (BOR v2) updates across all 4 layers of the CRATS EVM Protocol.

---

## 2. Granular Off-Chain Document Management (DMS v4) Architecture

CopyM and CRATS Protocol handle asset documentation via an off-chain DMS v4 pipeline with on-chain cryptographic anchor verification:

### 2.1 Asset Document Types & Storage
All uploaded asset files are saved locally on the CopyM backend filesystem at `backend/uploads/documents/assets/` and registered in `documentRegistryService.js`:
1. **Validation PDD (Project Design Document)**: Project scope, methodology, baseline emissions.
2. **Verification Report**: Independent audit attestation from Verra / Gold Standard accredited VVB.
3. **Annual Monitoring Report**: Verified annual emission reduction calculations.
4. **Credit Issuance Certificate**: Registry issuance proof with serial number range.
5. **Immobilization Proof**: Escrow attestation confirming physical assets or carbon credits are locked in registry treasury.

### 2.2 32-Byte Cryptographic Hash Anchoring
Every document has its SHA-256 digest calculated and anchored on Ethereum Sepolia in `CarbonAssetMetadataStore.sol` (`0xe15431397391d67CE9573c3D12315E547569a44b`):
- `pddHash` (bytes32)
- `verificationReportHash` (bytes32)
- `monitoringReportHash` (bytes32)
- `issuanceCertificateHash` (bytes32)
- `immobilizationProofHash` (bytes32)

The indexer stores both the local backend path link and the on-chain SHA-256 hash digest in `dms_documents` and `carbon_asset_metadata`.

---

## 3. Carbon Credit Tokenization, Batches & Offset Retirements

### 3.1 Carbon Asset Metadata & ICVCM Compliance
Indexed in `carbon_asset_metadata`:
- **Project ID**: Verra (e.g. `VCS-1842`) / Gold Standard (e.g. `GS-7312`).
- **Methodology**: VM0007 / ACM0002 / AR-ACM0003.
- **Project Type**: Afforestation & Reforestation (ARR), Renewable Energy, Cookstoves, Biochar (DACS).
- **Serial Number Range**: e.g., `1842-781920-791919-VCS-VCU-261-VER-ZA-14-1842-15012020-31122020-0`.
- **ICVCM CCP Approval**: High-integrity Core Carbon Principles approval flag (`icvcmApproved = true`).

### 3.2 Vintage Batches
Indexed in `carbon_batches`:
- `batchId`: Unique batch identifier.
- `vintageYear`: Production vintage (e.g. `2024`, `2025`).
- `totalCredits`: Total verified carbon credits minted.
- `availableCredits`: Remaining un-retired credits.
- `retiredCredits`: Cumulative retired carbon credits.

### 3.3 Carbon Offset Retirements & Automated Retries
Indexed in `carbon_retirement_records`:
- `retirementId`: Unique retirement identifier.
- `retireeAddress` & `retireeHandle`: Wallet address and human-readable handle (`@anas`).
- `amount`: Metric tons of CO2e retired.
- `beneficiaryName`: Corporate entity or individual beneficiary.
- `retirementReason`: Voluntary carbon footprint offset.
- `certificateCid`: IPFS CID of the generated retirement certificate.
- `status`: `SUCCESS`, `PENDING_RETRY`, or `ESCALATED`.
- **Automated 3x Retry Engine**: `CarbonRetirementManager.sol` (`0x29f1a6b5052a3a1AF33d18De48a19Ebf17f541d8`) attempts up to 3 automatic execution retries before escalating to governance.

---

## 4. Vault Yield, Continuous Fee Engine & NAV Accounting

### 4.1 Continuous Management Fee Accrual
Management fees accrue continuously on-chain and are checkpointed during deposits, withdrawals, and NAV updates via `FeeEngine.sol` (`0xB9E9B4Ff39def237BEcDE33ff80289340cA75Eaa`):

$$\text{Fee Accrued} = \frac{\text{Current AUM} \times \text{Management Fee (BPS)} \times \text{Elapsed Seconds}}{10,000 \times 31,536,000}$$

### 4.2 Performance Fee Carry Models
- **High-Water Mark (HWM)**: Used for Real Estate & Fine Art vaults. Performance fee (e.g. 20%) is only collected on NAV gains exceeding historical peak NAV.
- **Hurdle Rate**: Used for Private Credit & Corporate Debt vaults. Fees are only assessed on yields exceeding a fixed annual hurdle floor (e.g. 8% p.a.).

Indexed in `fee_accrual_logs`:
- `vaultAddress`, `feeType` (`MANAGEMENT`, `PERFORMANCE`, `ENTRY`, `EXIT`), `feeBps`, `feeAmountUsd`, `recipient`, `hwmCheckpoint`.

---

## 5. Complete 18-Table Database Schema Matrix (`prisma/schema.prisma`)

```
crats-indexer/
├── prisma/
│   └── schema.prisma    # Complete 4-Layer Database Models & Indexes
```

| Table Name | Layer | Purpose & Key Fields |
|---|---|---|
| `sbt_identities` | Layer 1 | ON-CHAIN DIDs, country codes, investor verification level (`RETAIL`, `ACCREDITED`, `INSTITUTIONAL`) |
| `wallet_compliance_states` | Layer 1 | Wallet restriction status (`isFrozen`, `isRestricted`), restriction code |
| `travel_rule_vasp_logs` | Layer 1 | VASP transfer compliance logs (`originatorAddress`, `beneficiaryAddress`, `amountUsd`, `status`) |
| `investor_rights_logs` | Layer 1 | Investor voting rights, dividend entitlement %, inspection rights |
| `indexed_assets` | Layer 2 | Asset ID, Name, Symbol, Decimals, Asset Category (`REAL_ESTATE`, `CARBON_CREDIT`, `FINE_ART`, etc.) |
| `carbon_asset_metadata` | Layer 2 | Verra/Gold Standard project ID, methodology, serial ranges, 32-byte DMS hashes |
| `carbon_batches` | Layer 2 | Vintage year batches, total, available, and retired credit quantities |
| `real_estate_metadata` | Layer 2 | Property name, property type, square footage, appraisal value USD, occupancy rate |
| `fine_art_metadata` | Layer 2 | Artwork title, artist name, medium, creation year, appraisal value, IPFS provenance URI |
| `dms_documents` | Layer 3 | Document ID, Asset ID, Document Type (`PROSPECTUS`, `PDD`, `VERIFICATION`), SHA-256 Hash, File URI |
| `indexed_vaults` | Layer 3 | Vault Address, Asset Token Address, Vault Type (`SYNC`/`ASYNC`), TVL, Total Shares |
| `vault_deposits_withdrawals` | Layer 3 | Investor Address, USDC Amount, Shares Minted/Burned, Entry NAV |
| `async_settlement_queue` | Layer 3 | Async redemption/deposit request queue (`PENDING`, `PROCESSED`, `CLAIMED`, `FAILED`) |
| `nav_attestations` | Layer 3 | NAV Value USD, Valuation Method, Submitter Address, Valuation Date, Attestation TxHash |
| `fee_accrual_logs` | Layer 3 | Fee Type (`MANAGEMENT`, `PERFORMANCE`), Fee BPS, Calculated USD, Recipient Wallet, HWM Checkpoint |
| `yield_distributions` / `claims` | Layer 3 | Dividend payouts, total yield USD, yield per share, snapshot blocks, claim records |
| `beneficial_owner_records` | Layer 4 | BOR v2 live holder balances, pro-rata ownership %, entry NAV, USD value mapped to `@handles` |
| `p2p_settlement_logs` | Layer 4 | Secondary P2P DvP swap audit logs (`@senderHandle` ──► `@receiverHandle`, quantity, price USD) |
| `carbon_retirement_records` | Layer 4 | Carbon offset retirement records, beneficiary name, IPFS CID, 3x retry status |
| `physical_redemptions` | Layer 4 | Physical RWA redemption requests, escrow status, delivery tracking reference |
| `asset_lifecycle_exits` | Layer 4 | Asset lifecycle termination, liquidation USDC pool amount, payout per share |

---

## 6. Production REST API Endpoints (`src/api/server.js`)

The indexer server (`PORT 5001`) exposes query endpoints consumed by CopyM applications:

| Endpoint | Method | Response Description |
|---|---|---|
| `/api/v1/bor/:tokenAddress` | `GET` | Live Beneficial Ownership Register (BOR) with investor `@handles` & ownership % |
| `/api/v1/carbon/metadata/:assetId` | `GET` | Carbon project metadata, vintage batches, and 32-byte DMS hashes |
| `/api/v1/p2p/settlements` | `GET` | Secondary P2P transfer audit logs (`@senderHandle` ──► `@receiverHandle`) |
| `/api/v1/carbon/retirements` | `GET` | Carbon credit offset retirement records |
| `/api/v1/compliance/states` | `GET` | On-chain wallet compliance states & freezing audit trail |
| `/api/v1/plugins/real-estate/:assetId` | `GET` | Real Estate property metadata, square footage, appraisal history |
| `/api/v1/plugins/fine-art/:assetId` | `GET` | Fine Art artwork title, artist, provenance IPFS URI, auth hash |
| `/api/v1/dms/documents/:assetId` | `GET` | Off-chain DMS document hashes and file URIs |
| `/api/v1/yield/distributions/:vaultAddress` | `GET` | Vault dividend distributions, snapshot blocks, claim records |
| `/api/v1/redemptions/physical` | `GET` | Physical RWA redemption tracking & delivery status |
| `/api/v1/compliance/travel-rule` | `GET` | Cross-border VASP Travel Rule compliance logs |

---

## 7. Verification & System Compliance

```
[ Blockchain Event: Sepolia Block #7,842,100 ]
       │
       ├─► EventIngestionService: Parses contract log topics
       │
       ├─► ProjectionEngine: Executes block-sequential transaction
       │      ├── borProjection.js ──────► Updates beneficial_owner_records (@anas)
       │      ├── carbonProjection.js ───► Updates carbon_retirement_records & batches
       │      ├── feeProjection.js ──────► Accrues continuous management fee BPS
       │      └── navProjection.js ──────► Updates nav_attestations
       │
       └─► REST API Server: Exposes instant responses to CopyM Admin/Investor/Issuer apps
```

* **Prisma Client Generation**: Generated `v6.19.3` with 0 schema compilation errors.
* **Re-org Protection**: Re-org rollback handler reverts projections on block parent hash mismatch.
