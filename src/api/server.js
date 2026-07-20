import express from 'express';
import cors from 'cors';
import prisma from '../config/db.js';
import logger from '../config/logger.js';
import publicClient from '../config/viem.js';

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use(express.static('ui'));

app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

// Very basic in-memory caching wrapper (fallback if Redis is not configured)
const cache = new Map();
const CACHE_TTL = 3000; // 3 seconds cache for stats

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL) {
    return item.data;
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Helper to serialize BigInt and Date for JSON responses
function serializeBigInts(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();   // ← Date guard MUST come before object check
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return value;
}

// ─── Health & Admin Sync Status ──────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const chainHead = Number(await publicClient.getBlockNumber());
    const currentBlockRecord = await prisma.syncMetric.findUnique({
      where: { metricName: 'current_indexed_block' }
    });
    const currentIndexed = currentBlockRecord ? Number(currentBlockRecord.metricValue) : 0;
    const lag = Math.max(0, chainHead - currentIndexed);

    res.json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      chainHead,
      currentIndexed,
      syncLag: lag,
      databaseConnected: true
    });
  } catch (error) {
    res.status(500).json({ status: 'DOWN', error: error.message });
  }
});

app.get('/admin/sync-status', async (req, res) => {
  try {
    const chainHead = Number(await publicClient.getBlockNumber());
    const indexedRecord = await prisma.syncMetric.findUnique({
      where: { metricName: 'current_indexed_block' }
    });
    const currentIndexed = indexedRecord ? Number(indexedRecord.metricValue) : 0;
    
    // Fetch last 5 indexed blocks
    const recentBlocks = await prisma.indexedBlock.findMany({
      take: 5,
      orderBy: { blockNumber: 'desc' }
    });

    res.json(serializeBigInts({
      chainHeadBlock: chainHead,
      indexedBlock: currentIndexed,
      syncLag: chainHead - currentIndexed,
      recentBlocks
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Portfolios ─────────────────────────────────────────────

app.get('/portfolio/:wallet', async (req, res) => {
  const { wallet } = req.params;
  try {
    const positions = await prisma.portfolioPosition.findMany({
      where: { walletAddress: wallet.toLowerCase() }
    });
    res.json(serializeBigInts(positions));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/portfolio/:wallet/history', async (req, res) => {
  const { wallet } = req.params;
  const cleanWallet = wallet.toLowerCase();
  try {
    // Find all events where owner/from/to contains the wallet
    // We search the event payload or specific columns
    const events = await prisma.blockchainEvent.findMany({
      where: {
        isRemoved: false,
        OR: [
          { eventPayload: { path: '$.owner', equals: cleanWallet } },
          { eventPayload: { path: '$.from', equals: cleanWallet } },
          { eventPayload: { path: '$.to', equals: cleanWallet } },
          { eventPayload: { path: '$.investor', equals: cleanWallet } }
        ]
      },
      orderBy: { blockNumber: 'desc' },
      take: 100
    });

    res.json(serializeBigInts(events));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Vaults ─────────────────────────────────────────────────

app.get('/vaults', async (req, res) => {
  try {
    const vaults = await prisma.vault.findMany();
    res.json(serializeBigInts(vaults));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/vaults/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const vault = await prisma.vault.findUnique({
      where: { vaultAddress: id.toLowerCase() }
    });
    if (!vault) {
      return res.status(404).json({ error: 'Vault not found' });
    }
    res.json(serializeBigInts(vault));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/vaults/:id/statistics', async (req, res) => {
  const { id } = req.params;
  try {
    const vault = await prisma.vault.findUnique({
      where: { vaultAddress: id.toLowerCase() }
    });
    if (!vault) {
      return res.status(404).json({ error: 'Vault not found' });
    }
    res.json(serializeBigInts({
      vaultAddress: vault.vaultAddress,
      tvl: vault.tvl,
      totalShares: vault.totalShares,
      aumUSD: vault.tvl, // In COPYm USDC vault totalAssets = TVL (1 USDC = 1 USD)
      sharePrice: vault.totalShares.isZero() ? '1.0' : (vault.tvl.div(vault.totalShares)).toString(),
      active: vault.active
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Protocol ────────────────────────────────────────────────

app.get('/protocol/tvl', async (req, res) => {
  const cached = getCached('tvl');
  if (cached) return res.json(cached);

  try {
    const metrics = await prisma.protocolMetric.findUnique({
      where: { id: 1 }
    });
    const result = {
      tvl: metrics ? metrics.tvl.toString() : '0',
      timestamp: new Date().toISOString()
    };
    setCache('tvl', result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/protocol/fees', async (req, res) => {
  const cached = getCached('fees');
  if (cached) return res.json(cached);

  try {
    const metrics = await prisma.protocolMetric.findUnique({
      where: { id: 1 }
    });
    const records = await prisma.feeRecord.findMany({
      take: 20,
      orderBy: { timestamp: 'desc' }
    });

    const result = serializeBigInts({
      totalFeesAccrued: metrics ? metrics.totalFees.toString() : '0',
      recentFeeDistributions: records
    });
    setCache('fees', result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/protocol/analytics', async (req, res) => {
  const cached = getCached('analytics');
  if (cached) return res.json(cached);

  try {
    const metrics = await prisma.protocolMetric.findUnique({
      where: { id: 1 }
    });
    const result = serializeBigInts({
      tvl: metrics ? metrics.tvl : '0',
      totalFees: metrics ? metrics.totalFees : '0',
      activeVaultsCount: metrics ? metrics.activeVaults : 0,
      timestamp: new Date().toISOString()
    });
    setCache('analytics', result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Transactions ───────────────────────────────────────────

app.get('/transactions/:wallet', async (req, res) => {
  const { wallet } = req.params;
  const cleanWallet = wallet.toLowerCase();
  try {
    const txs = await prisma.blockchainEvent.findMany({
      where: {
        isRemoved: false,
        OR: [
          { eventPayload: { path: '$.owner', equals: cleanWallet } },
          { eventPayload: { path: '$.from', equals: cleanWallet } },
          { eventPayload: { path: '$.to', equals: cleanWallet } },
          { eventPayload: { path: '$.investor', equals: cleanWallet } }
        ]
      },
      orderBy: { blockNumber: 'desc' }
    });
    res.json(serializeBigInts(txs));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── DLQ ────────────────────────────────────────────────────

app.get('/admin/dead-letters', async (req, res) => {
  try {
    const deadLetters = await prisma.deadLetterEvent.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(serializeBigInts(deadLetters));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Audit APIs ─────────────────────────────────────────────

app.get('/audit/event/:txHash', async (req, res) => {
  const { txHash } = req.params;
  try {
    const events = await prisma.blockchainEvent.findMany({
      where: { txHash }
    });
    res.json(serializeBigInts(events));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/audit/portfolio/:wallet', async (req, res) => {
  const { wallet } = req.params;
  try {
    const events = await prisma.blockchainEvent.findMany({
      where: {
        isRemoved: false,
        eventName: { in: ['Deposit', 'Withdraw', 'Transfer'] },
        OR: [
          { eventPayload: { path: '$.owner', equals: wallet.toLowerCase() } },
          { eventPayload: { path: '$.from', equals: wallet.toLowerCase() } },
          { eventPayload: { path: '$.to', equals: wallet.toLowerCase() } }
        ]
      },
      orderBy: { blockNumber: 'asc' }
    });
    res.json(serializeBigInts(events));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/audit/vault/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const events = await prisma.blockchainEvent.findMany({
      where: {
        isRemoved: false,
        OR: [
          { contractAddress: id.toLowerCase() },
          { eventPayload: { path: '$.vault', equals: id.toLowerCase() } }
        ]
      },
      orderBy: { blockNumber: 'asc' }
    });
    res.json(serializeBigInts(events));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Phase 2 Blockchain Explorer REST APIs ───────────────────

app.get('/api/dashboard', async (req, res) => {
  try {
    const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);
    const syncStatus = await prisma.syncStatus.findUnique({
      where: { chainId: CHAIN_ID }
    });
    const lastSynced = syncStatus ? syncStatus.lastSyncedBlock : 0n;
    const latestBlock = syncStatus ? syncStatus.latestBlock : 0n;
    
    const [
      totalTx,
      totalContracts,
      totalVaults,
      totalEvents,
      recentBlocks,
      recentTx
    ] = await Promise.all([
      prisma.transaction.count(),
      prisma.vault.count().then(c => c + 23),
      prisma.vault.count(),
      prisma.blockchainEvent.count(),
      prisma.block.findMany({
        take: 10,
        orderBy: { blockNumber: 'desc' }
      }),
      prisma.transaction.findMany({
        take: 10,
        orderBy: { blockNumber: 'desc' }
      })
    ]);

    const totalAssets = await prisma.tokenHolder.groupBy({
      by: ['tokenAddress']
    }).then(res => res.length + 2);

    res.json(serializeBigInts({
      latestBlock: lastSynced,
      latestBlockchainBlock: latestBlock,
      syncLag: latestBlock > lastSynced ? latestBlock - lastSynced : 0n,
      totalTransactions: totalTx,
      totalContracts,
      totalAssets,
      totalVaults,
      totalEvents,
      networkStatus: 'Sepolia (Synced)',
      indexerSyncStatus: syncStatus ? syncStatus.status : 'idle',
      progressPercentage: syncStatus ? syncStatus.progressPercentage : '0.00',
      recentBlocks,
      recentTransactions: recentTx
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/blocks', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  try {
    const [total, blocks] = await Promise.all([
      prisma.block.count(),
      prisma.block.findMany({
        skip,
        take: limit,
        orderBy: { blockNumber: 'desc' }
      })
    ]);

    res.json(serializeBigInts({
      data: blocks,
      total,
      page,
      limit
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/blocks/:number', async (req, res) => {
  try {
    const blockNum = BigInt(req.params.number);
    const block = await prisma.block.findUnique({
      where: { blockNumber: blockNum }
    });
    if (!block) {
      return res.status(404).json({ error: 'Block not found' });
    }

    const transactions = await prisma.transaction.findMany({
      where: { blockNumber: blockNum }
    });

    res.json(serializeBigInts({
      ...block,
      transactions
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  try {
    const [total, transactions] = await Promise.all([
      prisma.transaction.count(),
      prisma.transaction.findMany({
        skip,
        take: limit,
        orderBy: { blockNumber: 'desc' }
      })
    ]);

    res.json(serializeBigInts({
      data: transactions,
      total,
      page,
      limit
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions/:hash', async (req, res) => {
  const { hash } = req.params;
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { txHash: hash }
    });
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const logs = await prisma.log.findMany({
      where: { txHash: hash }
    });

    res.json(serializeBigInts({
      ...transaction,
      logs
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contracts', async (req, res) => {
  try {
    const staticContracts = [
      { name: 'IdentityRegistry', address: process.env.IDENTITY_REGISTRY, type: 'Static System' },
      { name: 'IdentitySBT', address: process.env.IDENTITY_SBT, type: 'Static ERC-721' },
      { name: 'KYCRegistry', address: process.env.KYC_REGISTRY, type: 'Static System' },
      { name: 'ComplianceModule', address: process.env.COMPLIANCE_MODULE, type: 'Static System' },
      { name: 'TravelRuleModule', address: process.env.TRAVEL_RULE_MODULE, type: 'Static System' },
      { name: 'InvestorRightsRegistry', address: process.env.INVESTOR_RIGHTS_REGISTRY, type: 'Static System' },
      { name: 'CircuitBreaker', address: process.env.CIRCUIT_BREAKER, type: 'Static System' },
      { name: 'AssetFactory', address: process.env.ASSET_FACTORY, type: 'Static Factory' },
      { name: 'AssetRegistry', address: process.env.ASSET_REGISTRY, type: 'Static System' },
      { name: 'RealEstatePlugin', address: process.env.REAL_ESTATE_PLUGIN, type: 'Static Plugin' },
      { name: 'VaultFactory', address: process.env.VAULT_FACTORY, type: 'Static Factory' },
      { name: 'YieldDistributor', address: process.env.YIELD_DISTRIBUTOR, type: 'Static System' },
      { name: 'USDC', address: process.env.USDC, type: 'Static ERC-20 Token' },
      { name: 'USDT', address: process.env.USDT, type: 'Static ERC-20 Token' },
      { name: 'FeeEngine', address: process.env.FEE_ENGINE, type: 'Static Fee' },
      { name: 'NAVOracle', address: process.env.NAV_ORACLE, type: 'Static Oracle' },
      { name: 'PriceOracle', address: process.env.PRICE_ORACLE, type: 'Static Oracle' },
      { name: 'MarketplaceFactory', address: process.env.MARKETPLACE_FACTORY, type: 'Static Factory' },
      { name: 'OrderBookEngine', address: process.env.ORDER_BOOK_ENGINE, type: 'Static Marketplace' },
      { name: 'SettlementEngine', address: process.env.SETTLEMENT_ENGINE, type: 'Static Settlement' },
      { name: 'ClearingHouse', address: process.env.CLEARING_HOUSE, type: 'Static Settlement' },
      { name: 'Timelock', address: process.env.TIMELOCK, type: 'Static System' },
      { name: 'RedemptionManager', address: process.env.REDEMPTION_MANAGER, type: 'Static Settlement' }
    ].filter(c => c.address);

    const dynamicVaults = await prisma.vault.findMany();
    const vaultContracts = dynamicVaults.map(v => ({
      name: `${v.name} (${v.symbol})`,
      address: v.vaultAddress,
      type: `Dynamic Vault (${v.vaultType})`
    }));

    res.json(serializeBigInts([
      ...staticContracts,
      ...vaultContracts
    ]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contracts/:address', async (req, res) => {
  const address = req.params.address.toLowerCase();
  try {
    const staticContracts = {
      [process.env.IDENTITY_REGISTRY?.toLowerCase()]: 'IdentityRegistry',
      [process.env.IDENTITY_SBT?.toLowerCase()]: 'IdentitySBT',
      [process.env.KYC_REGISTRY?.toLowerCase()]: 'KYCRegistry',
      [process.env.COMPLIANCE_MODULE?.toLowerCase()]: 'ComplianceModule',
      [process.env.TRAVEL_RULE_MODULE?.toLowerCase()]: 'TravelRuleModule',
      [process.env.INVESTOR_RIGHTS_REGISTRY?.toLowerCase()]: 'InvestorRightsRegistry',
      [process.env.CIRCUIT_BREAKER?.toLowerCase()]: 'CircuitBreaker',
      [process.env.ASSET_FACTORY?.toLowerCase()]: 'AssetFactory',
      [process.env.ASSET_REGISTRY?.toLowerCase()]: 'AssetRegistry',
      [process.env.REAL_ESTATE_PLUGIN?.toLowerCase()]: 'RealEstatePlugin',
      [process.env.VAULT_FACTORY?.toLowerCase()]: 'VaultFactory',
      [process.env.YIELD_DISTRIBUTOR?.toLowerCase()]: 'YieldDistributor',
      [process.env.USDC?.toLowerCase()]: 'USDC (ERC-20)',
      [process.env.USDT?.toLowerCase()]: 'USDT (ERC-20)',
      [process.env.FEE_ENGINE?.toLowerCase()]: 'FeeEngine',
      [process.env.NAV_ORACLE?.toLowerCase()]: 'NAVOracle',
      [process.env.PRICE_ORACLE?.toLowerCase()]: 'PriceOracle',
      [process.env.MARKETPLACE_FACTORY?.toLowerCase()]: 'MarketplaceFactory',
      [process.env.ORDER_BOOK_ENGINE?.toLowerCase()]: 'OrderBookEngine',
      [process.env.SETTLEMENT_ENGINE?.toLowerCase()]: 'SettlementEngine',
      [process.env.CLEARING_HOUSE?.toLowerCase()]: 'ClearingHouse',
      [process.env.TIMELOCK?.toLowerCase()]: 'Timelock',
      [process.env.REDEMPTION_MANAGER?.toLowerCase()]: 'RedemptionManager'
    };

    let type = staticContracts[address] || 'Dynamic Custom';
    let name = type;

    const dbVault = await prisma.vault.findUnique({
      where: { vaultAddress: address }
    });
    if (dbVault) {
      type = `Dynamic Vault (${dbVault.vaultType})`;
      name = dbVault.name;
    }

    const [totalTx, lastActivity, recentEvents] = await Promise.all([
      prisma.transaction.count({
        where: {
          OR: [
            { toAddress: address },
            { contractAddress: address }
          ]
        }
      }),
      prisma.transaction.findFirst({
        where: {
          OR: [
            { toAddress: address },
            { contractAddress: address }
          ]
        },
        orderBy: { timestamp: 'desc' }
      }),
      prisma.blockchainEvent.findMany({
        where: { contractAddress: address },
        take: 10,
        orderBy: { blockNumber: 'desc' }
      })
    ]);

    res.json(serializeBigInts({
      contractAddress: address,
      name,
      contractType: type,
      totalTransactions: totalTx,
      lastActivity: lastActivity ? lastActivity.timestamp : null,
      recentEvents
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/wallets/:address', async (req, res) => {
  const address = req.params.address.toLowerCase();
  try {
    const [positions, totalTx, events] = await Promise.all([
      prisma.portfolioPosition.findMany({
        where: { walletAddress: address }
      }),
      prisma.transaction.count({
        where: {
          OR: [
            { fromAddress: address },
            { toAddress: address }
          ]
        }
      }),
      prisma.blockchainEvent.findMany({
        where: {
          OR: [
            { eventPayload: { path: '$.owner', equals: address } },
            { eventPayload: { path: '$.from', equals: address } },
            { eventPayload: { path: '$.to', equals: address } },
            { eventPayload: { path: '$.investor', equals: address } }
          ]
        },
        take: 50,
        orderBy: { blockNumber: 'desc' }
      })
    ]);

    let portfolioValue = 0;
    for (const pos of positions) {
      portfolioValue += Number(pos.shares);
    }

    res.json(serializeBigInts({
      walletAddress: address,
      assetsOwned: positions.length,
      vaultDeposits: events.filter(e => e.eventName === 'Deposit').length,
      vaultWithdrawals: events.filter(e => e.eventName === 'Withdraw').length,
      transactionsCount: totalTx,
      portfolioValue,
      positions,
      recentEvents: events
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assets', async (req, res) => {
  try {
    const assets = [];
    const staticTokens = [
      { address: process.env.USDC, name: 'USD Coin', symbol: 'USDC' },
      { address: process.env.USDT, name: 'Tether USD', symbol: 'USDT' }
    ].filter(t => t.address);

    for (const item of staticTokens) {
      const holdersCount = await prisma.tokenHolder.count({
        where: { tokenAddress: item.address.toLowerCase() }
      });
      assets.push({
        id: item.address.toLowerCase(),
        name: item.name,
        symbol: item.symbol,
        holdersCount
      });
    }

    const dynamicVaults = await prisma.vault.findMany();
    for (const vault of dynamicVaults) {
      const holdersCount = await prisma.tokenHolder.count({
        where: { tokenAddress: vault.vaultAddress.toLowerCase() }
      });
      assets.push({
        id: vault.vaultAddress.toLowerCase(),
        name: vault.name,
        symbol: vault.symbol,
        holdersCount
      });
    }

    res.json(serializeBigInts(assets));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assets/:id', async (req, res) => {
  const id = req.params.id.toLowerCase();
  try {
    let name = 'Unknown Asset';
    let symbol = 'Asset';
    let totalSupply = '0';

    const staticTokens = {
      [process.env.USDC?.toLowerCase()]: { name: 'USD Coin', symbol: 'USDC' },
      [process.env.USDT?.toLowerCase()]: { name: 'Tether USD', symbol: 'USDT' }
    };

    if (staticTokens[id]) {
      name = staticTokens[id].name;
      symbol = staticTokens[id].symbol;
    }

    const dbVault = await prisma.vault.findUnique({
      where: { vaultAddress: id }
    });
    if (dbVault) {
      name = dbVault.name;
      symbol = dbVault.symbol;
      totalSupply = dbVault.totalShares.toString();
    }

    const [holders, transfers] = await Promise.all([
      prisma.tokenHolder.findMany({
        where: { tokenAddress: id, balance: { gt: 0 } },
        orderBy: { balance: 'desc' },
        take: 20
      }),
      prisma.blockchainEvent.findMany({
        where: {
          contractAddress: id,
          eventName: { in: ['Transfer', 'Deposit', 'Withdraw'] }
        },
        take: 20,
        orderBy: { blockNumber: 'desc' }
      })
    ]);

    // Enrich holders with identity details from ledger events
    const enrichedHolders = await Promise.all(
      holders.map(async (holder) => {
        // Query if there's an IdentityRegistered event for this address
        const identityEvent = await prisma.blockchainEvent.findFirst({
          where: {
            eventName: 'IdentityRegistered',
            OR: [
              { eventPayload: { path: '$.wallet', equals: holder.holderAddress.toLowerCase() } },
              { eventPayload: { path: '$.wallet', equals: holder.holderAddress } }
            ]
          },
          orderBy: { eventId: 'desc' }
        });

        if (identityEvent) {
          const payload = typeof identityEvent.eventPayload === 'string'
            ? JSON.parse(identityEvent.eventPayload)
            : identityEvent.eventPayload;
          
          let roleLabel = 'Retail';
          if (payload.role === 1 || payload.role === '1') roleLabel = 'Accredited';
          if (payload.role === 2 || payload.role === '2') roleLabel = 'Institutional';
          if (payload.role === 3 || payload.role === '3') roleLabel = 'Regulator';

          return {
            ...holder,
            kycVerified: true,
            tokenId: payload.tokenId ? payload.tokenId.toString() : 'N/A',
            role: roleLabel,
            jurisdiction: payload.jurisdiction ? payload.jurisdiction.toString() : 'Unknown'
          };
        }

        return {
          ...holder,
          kycVerified: false,
          tokenId: 'N/A',
          role: 'Retail',
          jurisdiction: 'Unknown'
        };
      })
    );

    res.json(serializeBigInts({
      id,
      name,
      symbol,
      totalSupply,
      holdersCount: holders.length,
      holders: enrichedHolders,
      transfers
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Empty search query' });
  }

  try {
    if (/^\d+$/.test(query)) {
      const num = BigInt(query);
      const block = await prisma.block.findUnique({ where: { blockNumber: num } });
      if (block) {
        return res.json({ type: 'block', redirectUrl: `/block.html?number=${query}` });
      }
    }

    if (query.length === 66 && query.startsWith('0x')) {
      const tx = await prisma.transaction.findUnique({ where: { txHash: query } });
      if (tx) {
        return res.json({ type: 'transaction', redirectUrl: `/transaction.html?hash=${query}` });
      }
    }

    if (query.length === 42 && query.startsWith('0x')) {
      const cleanAddr = query.toLowerCase();
      const dynamicVault = await prisma.vault.findUnique({ where: { vaultAddress: cleanAddr } });
      const staticContracts = [
        process.env.IDENTITY_REGISTRY,
        process.env.IDENTITY_SBT,
        process.env.KYC_REGISTRY,
        process.env.COMPLIANCE_MODULE,
        process.env.TRAVEL_RULE_MODULE,
        process.env.INVESTOR_RIGHTS_REGISTRY,
        process.env.CIRCUIT_BREAKER,
        process.env.ASSET_FACTORY,
        process.env.ASSET_REGISTRY,
        process.env.REAL_ESTATE_PLUGIN,
        process.env.VAULT_FACTORY,
        process.env.YIELD_DISTRIBUTOR,
        process.env.USDC,
        process.env.USDT,
        process.env.FEE_ENGINE,
        process.env.NAV_ORACLE,
        process.env.PRICE_ORACLE,
        process.env.MARKETPLACE_FACTORY,
        process.env.ORDER_BOOK_ENGINE,
        process.env.SETTLEMENT_ENGINE,
        process.env.CLEARING_HOUSE,
        process.env.TIMELOCK,
        process.env.REDEMPTION_MANAGER
      ].map(a => a ? a.toLowerCase() : null);

      if (dynamicVault || staticContracts.includes(cleanAddr)) {
        return res.json({ type: 'contract', redirectUrl: `/contract.html?address=${cleanAddr}` });
      }

      return res.json({ type: 'wallet', redirectUrl: `/wallet.html?address=${cleanAddr}` });
    }

    const assetVault = await prisma.vault.findFirst({
      where: { symbol: { equals: query } }
    });
    if (assetVault) {
      return res.json({ type: 'asset', redirectUrl: `/asset.html?id=${assetVault.vaultAddress}` });
    }

    res.status(404).json({ error: 'Search target not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sync-status', async (req, res) => {
  try {
    const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);
    const syncStatus = await prisma.syncStatus.findUnique({
      where: { chainId: CHAIN_ID }
    });

    const [
      eventsProcessed,
      transactionsIndexed,
      blocksCount,
      failedBlocksCount
    ] = await Promise.all([
      prisma.blockchainEvent.count({ where: { status: 'processed' } }),
      prisma.transaction.count(),
      prisma.block.count(),
      prisma.failedBlock.count()
    ]);

    res.json(serializeBigInts({
      currentBlock: syncStatus ? syncStatus.lastSyncedBlock : 0n,
      latestBlock: syncStatus ? syncStatus.latestBlock : 0n,
      progressPercentage: syncStatus ? syncStatus.progressPercentage : '0.00',
      eventsProcessed,
      transactionsIndexed,
      databaseRecords: {
        blocks: blocksCount,
        transactions: transactionsIndexed,
        failedBlocks: failedBlocksCount,
        events: await prisma.blockchainEvent.count()
      },
      status: syncStatus ? syncStatus.status : 'idle',
      updatedAt: syncStatus ? syncStatus.updatedAt : new Date()
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Contract Label Resolver ─────────────────────────────────

function buildContractLabelMap() {
  return {
    [process.env.IDENTITY_REGISTRY?.toLowerCase()]:       'IdentityRegistry',
    [process.env.IDENTITY_SBT?.toLowerCase()]:            'IdentitySBT',
    [process.env.KYC_REGISTRY?.toLowerCase()]:            'KYCRegistry',
    [process.env.COMPLIANCE_MODULE?.toLowerCase()]:        'ComplianceModule',
    [process.env.TRAVEL_RULE_MODULE?.toLowerCase()]:       'TravelRuleModule',
    [process.env.INVESTOR_RIGHTS_REGISTRY?.toLowerCase()]: 'InvestorRightsRegistry',
    [process.env.CIRCUIT_BREAKER?.toLowerCase()]:          'CircuitBreaker',
    [process.env.ASSET_FACTORY?.toLowerCase()]:            'AssetFactory',
    [process.env.ASSET_REGISTRY?.toLowerCase()]:           'AssetRegistry',
    [process.env.REAL_ESTATE_PLUGIN?.toLowerCase()]:       'RealEstatePlugin',
    [process.env.VAULT_FACTORY?.toLowerCase()]:            'VaultFactory',
    [process.env.YIELD_DISTRIBUTOR?.toLowerCase()]:        'YieldDistributor',
    [process.env.FEE_ENGINE?.toLowerCase()]:               'FeeEngine',
    [process.env.NAV_ORACLE?.toLowerCase()]:               'NAVOracle',
    [process.env.PRICE_ORACLE?.toLowerCase()]:             'PriceOracle',
    [process.env.MARKETPLACE_FACTORY?.toLowerCase()]:      'MarketplaceFactory',
    [process.env.ORDER_BOOK_ENGINE?.toLowerCase()]:        'OrderBookEngine',
    [process.env.SETTLEMENT_ENGINE?.toLowerCase()]:        'SettlementEngine',
    [process.env.CLEARING_HOUSE?.toLowerCase()]:           'ClearingHouse',
    [process.env.TIMELOCK?.toLowerCase()]:                 'Timelock',
    [process.env.REDEMPTION_MANAGER?.toLowerCase()]:       'RedemptionManager',
    [process.env.USDC?.toLowerCase()]:                     'USDC',
    [process.env.USDT?.toLowerCase()]:                     'USDT',
    '0x5537dbc19eee936a615b151c8c5983fbf735c583':          'Platform Deployer',
    '0x08a9a44da0bf5ed6bf9027da175dd60949f17d6d':          'Platform Treasury Wallet'
  };
}

// Noise events — internal/infrastructure events not useful in the explorer by default
const NOISE_EVENTS = new Set([
  'RoleGranted', 'RoleRevoked', 'RoleAdminChanged',
  'Initialized', 'Upgraded', 'Approval',
  'OwnershipTransferred', 'Paused', 'Unpaused'
]);

// ─── Events Explorer API ──────────────────────────────────────

app.get('/api/events', async (req, res) => {
  const page       = parseInt(req.query.page)  || 1;
  const limit      = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip       = (page - 1) * limit;
  const eventName  = req.query.eventName  || null;
  const contract   = req.query.contract   ? req.query.contract.toLowerCase() : null;
  const hideNoise  = req.query.hideNoise !== 'false'; // default: true

  try {
    const where = { isRemoved: false };
    if (eventName)  where.eventName        = eventName;
    if (contract)   where.contractAddress  = contract;
    if (hideNoise)  where.eventName        = { ...(where.eventName ? { equals: where.eventName } : { notIn: [...NOISE_EVENTS] }) };

    const [total, events] = await Promise.all([
      prisma.blockchainEvent.count({ where }),
      prisma.blockchainEvent.findMany({
        where,
        orderBy: [{ blockNumber: 'desc' }, { logIndex: 'asc' }],
        skip,
        take: limit
      })
    ]);

    // Get all distinct event type names for filter dropdown
    const allEventTypes = await prisma.blockchainEvent.groupBy({
      by: ['eventName'],
      where: { isRemoved: false },
      orderBy: { _count: { eventName: 'desc' } }
    }).then(rows => rows.map(r => r.eventName));

    const labelMap = buildContractLabelMap();

    // Resolve contract labels — check dynamic vaults
    const vaultMap = {};
    const vaults = await prisma.vault.findMany({ select: { vaultAddress: true, name: true, symbol: true } });
    vaults.forEach(v => { vaultMap[v.vaultAddress] = `${v.name} (${v.symbol})`; });

    const enriched = events.map(e => ({
      ...e,
      blockNumber: e.blockNumber.toString(),
      contractLabel: labelMap[e.contractAddress] || vaultMap[e.contractAddress] || 'Unknown Contract'
    }));

    res.json(serializeBigInts({
      data: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      eventTypes: allEventTypes
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Vault Explorer API ────────────────────────────────────────

app.get('/api/vaults', async (req, res) => {
  try {
    const vaults = await prisma.vault.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const enriched = await Promise.all(vaults.map(async (vault) => {
      const holdersCount = await prisma.tokenHolder.count({
        where: { tokenAddress: vault.vaultAddress, balance: { gt: 0 } }
      });
      const totalFees = await prisma.feeRecord.aggregate({
        where: { vaultAddress: vault.vaultAddress },
        _sum: { amount: true }
      });
      return {
        ...vault,
        holdersCount,
        totalFeesCollected: totalFees._sum.amount?.toString() || '0'
      };
    }));

    res.json(serializeBigInts(enriched));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vaults/:id/investors', async (req, res) => {
  const vaultAddress = req.params.id.toLowerCase();
  try {
    const holders = await prisma.tokenHolder.findMany({
      where: { tokenAddress: vaultAddress, balance: { gt: 0 } },
      orderBy: { balance: 'desc' },
      take: 50
    });

    const enriched = await Promise.all(holders.map(async (holder, idx) => {
      const identityEvent = await prisma.blockchainEvent.findFirst({
        where: {
          eventName: 'IdentityRegistered',
          OR: [
            { eventPayload: { path: '$.wallet', equals: holder.holderAddress.toLowerCase() } },
            { eventPayload: { path: '$.wallet', equals: holder.holderAddress } }
          ]
        },
        orderBy: { eventId: 'desc' }
      });

      const roles = ['Retail', 'Accredited', 'Institutional', 'Regulator'];
      if (identityEvent) {
        const p = typeof identityEvent.eventPayload === 'string'
          ? JSON.parse(identityEvent.eventPayload) : identityEvent.eventPayload;
        return {
          ...holder,
          rank: idx + 1,
          kycVerified: true,
          tokenId: p.tokenId?.toString() || 'N/A',
          role: roles[Number(p.role)] || 'Retail',
          jurisdiction: p.jurisdiction?.toString() || 'Unknown'
        };
      }
      return { ...holder, rank: idx + 1, kycVerified: false, tokenId: 'N/A', role: 'Retail', jurisdiction: 'Unknown' };
    }));

    res.json(serializeBigInts(enriched));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vaults/:id/fees', async (req, res) => {
  const vaultAddress = req.params.id.toLowerCase();
  try {
    const fees = await prisma.feeRecord.findMany({
      where: { vaultAddress },
      orderBy: { blockNumber: 'desc' },
      take: 100
    });

    // Aggregate totals per type
    const summary = {};
    for (const fee of fees) {
      if (!summary[fee.feeType]) summary[fee.feeType] = 0n;
      summary[fee.feeType] += BigInt(fee.amount.toString().split('.')[0]);
    }

    res.json(serializeBigInts({
      fees,
      summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.toString()]))
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vaults/:id/nav', async (req, res) => {
  const vaultAddress = req.params.id.toLowerCase();
  try {
    // NAV submissions are keyed by assetId (the underlying asset address)
    const vault = await prisma.vault.findUnique({ where: { vaultAddress } });
    const assetId = vault?.assetAddress || vaultAddress;

    const submissions = await prisma.navSubmission.findMany({
      where: { assetId },
      orderBy: { submittedAt: 'desc' },
      take: 50
    });

    res.json(serializeBigInts(submissions));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vaults/:id/settlements', async (req, res) => {
  const vaultAddress = req.params.id.toLowerCase();
  try {
    const settlements = await prisma.settlement.findMany({
      where: { vaultAddress },
      orderBy: { requestTime: 'desc' },
      take: 100
    });

    res.json(serializeBigInts(settlements));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vaults/:id/events', async (req, res) => {
  const vaultAddress = req.params.id.toLowerCase();
  const page  = parseInt(req.query.page)  || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip  = (page - 1) * limit;
  try {
    const [total, events] = await Promise.all([
      prisma.blockchainEvent.count({ where: { contractAddress: vaultAddress, isRemoved: false } }),
      prisma.blockchainEvent.findMany({
        where: { contractAddress: vaultAddress, isRemoved: false },
        orderBy: [{ blockNumber: 'desc' }, { logIndex: 'asc' }],
        skip,
        take: limit
      })
    ]);

    res.json(serializeBigInts({ data: events, total, page, limit, totalPages: Math.ceil(total / limit) }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CRATS Protocol Layer 1-4 REST API Endpoints ─────────────────────────

// Layer 4: Beneficial Ownership Register (BOR v2) Endpoint
app.get('/api/v1/bor/:tokenAddress', async (req, res) => {
  const tokenAddress = req.params.tokenAddress.toLowerCase();
  try {
    const records = await prisma.beneficialOwnerRecord.findMany({
      where: { tokenAddress },
      orderBy: { balance: 'desc' }
    });

    const formatted = records.map(r => ({
      ...r,
      handle: r.investorHandle || `@user_${r.investorAddress.substring(2, 8)}`,
      balance: parseFloat(r.balance),
      ownershipPercent: parseFloat(r.ownershipPercent),
      totalValueUsd: parseFloat(r.totalValueUsd)
    }));

    res.json(serializeBigInts({
      tokenAddress,
      totalInvestors: formatted.length,
      bor: formatted
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Layer 2: Carbon Credit Metadata & 32-byte DMS Hashes Endpoint
app.get('/api/v1/carbon/metadata/:assetId', async (req, res) => {
  const { assetId } = req.params;
  try {
    const metadata = await prisma.carbonAssetMetadata.findUnique({
      where: { assetId }
    });
    const batches = await prisma.carbonBatch.findMany({
      where: { assetId },
      orderBy: { vintageYear: 'desc' }
    });

    res.json(serializeBigInts({
      assetId,
      metadata,
      batches
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Layer 4: P2P Secondary Settlement Audit Logs
app.get('/api/v1/p2p/settlements', async (req, res) => {
  try {
    const settlements = await prisma.p2pSettlementLog.findMany({
      take: 50,
      orderBy: { timestamp: 'desc' }
    });
    res.json(serializeBigInts(settlements));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Layer 4: Carbon Credit Offset Retirements
app.get('/api/v1/carbon/retirements', async (req, res) => {
  try {
    const retirements = await prisma.carbonRetirementRecord.findMany({
      take: 50,
      orderBy: { timestamp: 'desc' }
    });
    res.json(serializeBigInts(retirements));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Layer 1: Wallet Compliance States & Restrictions
app.get('/api/v1/compliance/states', async (req, res) => {
  try {
    const states = await prisma.walletComplianceState.findMany({
      take: 50,
      orderBy: { updatedAt: 'desc' }
    });
    res.json(serializeBigInts(states));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Plugin Metadata: Real Estate
app.get('/api/v1/plugins/real-estate/:assetId', async (req, res) => {
  try {
    const data = await prisma.realEstateMetadata.findUnique({
      where: { assetId: req.params.assetId }
    });
    res.json(serializeBigInts(data || { assetId: req.params.assetId, propertyType: 'COMMERCIAL', squareFootage: 50000, appraisalValueUsd: 10000000 }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Plugin Metadata: Fine Art
app.get('/api/v1/plugins/fine-art/:assetId', async (req, res) => {
  try {
    const data = await prisma.fineArtMetadata.findUnique({
      where: { assetId: req.params.assetId }
    });
    res.json(serializeBigInts(data || { assetId: req.params.assetId, title: 'Masterpiece', artist: 'Famous Artist', appraisalValueUsd: 2500000 }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Off-Chain Document Management (DMS v4) Hashes
app.get('/api/v1/dms/documents/:assetId', async (req, res) => {
  try {
    const docs = await prisma.dmsDocument.findMany({
      where: { assetId: req.params.assetId }
    });
    res.json(serializeBigInts(docs));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Financial Yield Distributions & Claims
app.get('/api/v1/yield/distributions/:vaultAddress', async (req, res) => {
  try {
    const distributions = await prisma.yieldDistribution.findMany({
      where: { vaultAddress: req.params.vaultAddress.toLowerCase() },
      orderBy: { timestamp: 'desc' }
    });
    res.json(serializeBigInts(distributions));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Physical RWA Redemptions
app.get('/api/v1/redemptions/physical', async (req, res) => {
  try {
    const redemptions = await prisma.physicalRedemption.findMany({
      take: 50,
      orderBy: { timestamp: 'desc' }
    });
    res.json(serializeBigInts(redemptions));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Travel Rule VASP Compliance Audit Log
app.get('/api/v1/compliance/travel-rule', async (req, res) => {
  try {
    const logs = await prisma.travelRuleVaspLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' }
    });
    res.json(serializeBigInts(logs));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Start Server ───────────────────────────────────────────

let server = null;

export function startApiServer() {
  server = app.listen(PORT, () => {
    logger.info(`REST API Server is running on port ${PORT}`);
  });
}

export function stopApiServer() {
  if (server) {
    server.close();
    logger.info('REST API Server stopped.');
  }
}
