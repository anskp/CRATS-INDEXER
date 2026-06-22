const API_BASE = '/api';

// Utility helper functions
function formatAddress(address, length = 6) {
  if (!address) return 'N/A';
  if (address === '0x0000000000000000000000000000000000000000') return 'Null Address';
  return `${address.substring(0, 2 + length)}...${address.substring(address.length - length)}`;
}

function formatWei(weiString, decimals = 18) {
  if (!weiString || weiString === '0') return '0 ETH';
  try {
    const big = BigInt(weiString);
    const divisor = 10n ** BigInt(decimals);
    const quotient = big / divisor;
    const remainder = big % divisor;
    
    let remStr = remainder.toString().padStart(decimals, '0');
    // Trim trailing zeros
    remStr = remStr.replace(/0+$/, '');
    if (remStr.length === 0) return `${quotient.toString()} ETH`;
    
    // Limit to 4 decimal places for clean UI representation
    return `${quotient.toString()}.${remStr.substring(0, 4)} ETH`;
  } catch (e) {
    return '0 ETH';
  }
}

function formatTimestamp(isoString) {
  if (!isoString) return 'Pending';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function getRelativeTime(isoString) {
  if (!isoString) return 'Pending';
  const date = new Date(isoString);
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function showToast(message) {
  const toast = document.getElementById('error-toast') || createToastElement();
  toast.innerText = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 4000);
}

function createToastElement() {
  const t = document.createElement('div');
  t.id = 'error-toast';
  t.className = 'toast';
  document.body.appendChild(t);
  return t;
}

// Global search handling
function initSearch() {
  const searchForms = document.querySelectorAll('.search-form');
  searchForms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const query = input.value.trim();
      if (!query) return;

      try {
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) {
          showToast('Search target not found. Please search valid block number, tx hash, address, or asset symbol.');
          return;
        }
        const data = await res.json();
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
        }
      } catch (err) {
        showToast('Error executing search query.');
      }
    });
  });
}

// Polling for sync progress
function initSyncStatusPolling() {
  const updateBanner = async () => {
    try {
      const res = await fetch(`${API_BASE}/sync-status`);
      if (!res.ok) return;
      const data = await res.json();

      const syncedEl = document.getElementById('sync-banner-synced');
      const latestEl = document.getElementById('sync-banner-latest');
      const pctEl = document.getElementById('sync-banner-pct');
      const barEl = document.getElementById('sync-banner-bar');
      const statusText = document.getElementById('sync-banner-status');

      if (syncedEl) syncedEl.innerText = data.currentBlock;
      if (latestEl) latestEl.innerText = data.latestBlock;
      if (pctEl) pctEl.innerText = `${data.progressPercentage}%`;
      if (barEl) barEl.style.width = `${data.progressPercentage}%`;
      if (statusText) {
        statusText.innerText = data.status === 'completed' 
          ? 'Synced to Head' 
          : `Syncing Block Details...`;
      }
    } catch (e) {
      // Fail silently
    }
  };

  updateBanner();
  setInterval(updateBanner, 5000);
}

// Dynamic loaders
function showLoading(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    el.innerHTML = `
      <div class="loader-container">
        <div class="spinner-large"></div>
        <p>Loading details from ledger...</p>
      </div>
    `;
  }
}

// ─── Dashboard Page Controller ────────────────────────────────
async function loadDashboard() {
  showLoading('recent-blocks-body');
  showLoading('recent-tx-body');

  try {
    const res = await fetch(`${API_BASE}/dashboard`);
    if (!res.ok) throw new Error('Failed to fetch dashboard data');
    const data = await res.json();

    // Populate stats
    document.getElementById('stat-latest-block').innerText = data.latestBlock;
    document.getElementById('stat-total-tx').innerText = data.totalTransactions;
    document.getElementById('stat-total-contracts').innerText = data.totalContracts;
    document.getElementById('stat-total-assets').innerText = data.totalAssets;
    document.getElementById('stat-total-vaults').innerText = data.totalVaults;
    document.getElementById('stat-total-events').innerText = data.totalEvents;
    document.getElementById('stat-network').innerText = data.networkStatus;
    document.getElementById('stat-sync-percentage').innerText = `${data.progressPercentage}%`;

    // Populate recent blocks list
    const blocksBody = document.getElementById('recent-blocks-body');
    blocksBody.innerHTML = '';
    
    if (data.recentBlocks.length === 0) {
      blocksBody.innerHTML = '<div class="empty-state">No blocks indexed yet. Run the backfill engine!</div>';
    } else {
      data.recentBlocks.forEach(block => {
        blocksBody.innerHTML += `
          <div class="feed-item">
            <div class="feed-icon">BK</div>
            <div class="feed-info">
              <a href="/block.html?number=${block.blockNumber}" class="feed-main">Block #${block.blockNumber}</a>
              <div class="feed-sub">${getRelativeTime(block.timestamp)}</div>
            </div>
            <div class="feed-value">
              <div class="feed-main">${block.txCount} txs</div>
              <div class="feed-sub">${block.gasUsed} gas</div>
            </div>
          </div>
        `;
      });
    }

    // Populate recent transactions list
    const txBody = document.getElementById('recent-tx-body');
    txBody.innerHTML = '';

    if (data.recentTransactions.length === 0) {
      txBody.innerHTML = '<div class="empty-state">No transactions indexed yet. Run backfill!</div>';
    } else {
      data.recentTransactions.forEach(tx => {
        txBody.innerHTML += `
          <div class="feed-item">
            <div class="feed-icon">TX</div>
            <div class="feed-info">
              <a href="/transaction.html?hash=${tx.txHash}" class="feed-main">${formatAddress(tx.txHash, 8)}</a>
              <div class="feed-sub">From ${formatAddress(tx.fromAddress)} to ${tx.toAddress ? formatAddress(tx.toAddress) : formatAddress(tx.contractAddress || '')}</div>
            </div>
            <div class="feed-value">
              <div class="value-badge">${formatWei(tx.value)}</div>
              <div class="feed-sub">${getRelativeTime(tx.timestamp)}</div>
            </div>
          </div>
        `;
      });
    }
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Blocks Page Controller ──────────────────────────────────
let currentBlocksPage = 1;
async function loadBlocksList(page = 1) {
  showLoading('blocks-table-body');
  try {
    const res = await fetch(`${API_BASE}/blocks?page=${page}&limit=10`);
    if (!res.ok) throw new Error('Failed to load blocks list');
    const result = await res.json();

    const body = document.getElementById('blocks-table-body');
    body.innerHTML = '';

    if (result.data.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No blocks indexed.</td></tr>';
      return;
    }

    result.data.forEach(block => {
      body.innerHTML += `
        <tr>
          <td><a href="/block.html?number=${block.blockNumber}" class="block-link">#${block.blockNumber}</a></td>
          <td>${formatTimestamp(block.timestamp)}</td>
          <td>${block.txCount}</td>
          <td>${block.gasUsed}</td>
          <td class="tx-hash">${formatAddress(block.blockHash, 12)}</td>
        </tr>
      `;
    });

    // Handle pagination controls
    document.getElementById('blocks-prev').disabled = page <= 1;
    document.getElementById('blocks-next').disabled = page * 10 >= result.total;
    document.getElementById('blocks-page-num').innerText = `Page ${page} of ${Math.ceil(result.total / 10) || 1}`;
    currentBlocksPage = page;
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Block Details Page Controller ────────────────────────────
async function loadBlockDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const blockNumber = urlParams.get('number');
  if (!blockNumber) {
    window.location.href = '/blocks.html';
    return;
  }

  showLoading('block-details-container');
  try {
    const res = await fetch(`${API_BASE}/blocks/${blockNumber}`);
    if (!res.ok) throw new Error('Block not found in local indexer.');
    const block = await res.json();

    const container = document.getElementById('block-details-container');
    container.innerHTML = `
      <div class="detail-card">
        <div class="detail-row">
          <div class="detail-label">Block Number</div>
          <div class="detail-value" style="font-weight: 700; font-size: 1.1rem;">#${block.blockNumber}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Timestamp</div>
          <div class="detail-value">${formatTimestamp(block.timestamp)} (${getRelativeTime(block.timestamp)})</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Transactions Count</div>
          <div class="detail-value">${block.txCount} transactions</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Gas Used</div>
          <div class="detail-value">${block.gasUsed}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Block Hash</div>
          <div class="detail-value font-mono">${block.blockHash}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Parent Hash</div>
          <div class="detail-value font-mono"><a href="/block.html?number=${BigInt(block.blockNumber) - 1n}">${block.parentHash}</a></div>
        </div>
      </div>

      <h3 style="margin-bottom: 1rem;">Transactions inside Block #${block.blockNumber}</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Tx Hash</th>
              <th>From</th>
              <th>To / Contract</th>
              <th>Method</th>
              <th>Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="block-tx-body"></tbody>
        </table>
      </div>
    `;

    const txBody = document.getElementById('block-tx-body');
    if (block.transactions.length === 0) {
      txBody.innerHTML = '<tr><td colspan="6" class="empty-state">No transactions indexed in this block.</td></tr>';
    } else {
      block.transactions.forEach(tx => {
        const toVal = tx.toAddress 
          ? `<a href="/wallet.html?address=${tx.toAddress}" class="address-link">${formatAddress(tx.toAddress)}</a>` 
          : `<a href="/contract.html?address=${tx.contractAddress || ''}" class="address-link">${formatAddress(tx.contractAddress || '')} <span class="badge badge-info">Deploy</span></a>`;

        const badgeClass = tx.status === 'SUCCESS' ? 'badge-success' : 'badge-danger';

        txBody.innerHTML += `
          <tr>
            <td><a href="/transaction.html?hash=${tx.txHash}" class="tx-hash">${formatAddress(tx.txHash, 8)}</a></td>
            <td><a href="/wallet.html?address=${tx.fromAddress}" class="address-link">${formatAddress(tx.fromAddress)}</a></td>
            <td>${toVal}</td>
            <td><span class="badge badge-gray">${tx.method}</span></td>
            <td>${formatWei(tx.value)}</td>
            <td><span class="badge ${badgeClass}">${tx.status}</span></td>
          </tr>
        `;
      });
    }
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Transactions Page Controller ────────────────────────────
let currentTxPage = 1;
async function loadTransactionsList(page = 1) {
  showLoading('tx-table-body');
  try {
    const res = await fetch(`${API_BASE}/transactions?page=${page}&limit=10`);
    if (!res.ok) throw new Error('Failed to load transactions');
    const result = await res.json();

    const body = document.getElementById('tx-table-body');
    body.innerHTML = '';

    if (result.data.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="empty-state">No transactions indexed.</td></tr>';
      return;
    }

    result.data.forEach(tx => {
      const toVal = tx.toAddress 
        ? `<a href="/wallet.html?address=${tx.toAddress}" class="address-link">${formatAddress(tx.toAddress)}</a>` 
        : `<a href="/contract.html?address=${tx.contractAddress || ''}" class="address-link">${formatAddress(tx.contractAddress || '')}</a>`;

      const statusBadge = tx.status === 'SUCCESS' ? 'badge-success' : 'badge-danger';

      body.innerHTML += `
        <tr>
          <td><a href="/transaction.html?hash=${tx.txHash}" class="tx-hash">${formatAddress(tx.txHash, 8)}</a></td>
          <td><a href="/block.html?number=${tx.blockNumber}" class="block-link">#${tx.blockNumber}</a></td>
          <td>${formatTimestamp(tx.timestamp)}</td>
          <td><a href="/wallet.html?address=${tx.fromAddress}" class="address-link">${formatAddress(tx.fromAddress)}</a></td>
          <td>${toVal}</td>
          <td><span class="badge badge-gray">${tx.method}</span></td>
          <td>${formatWei(tx.value)}</td>
          <td><span class="badge ${statusBadge}">${tx.status}</span></td>
        </tr>
      `;
    });

    document.getElementById('tx-prev').disabled = page <= 1;
    document.getElementById('tx-next').disabled = page * 10 >= result.total;
    document.getElementById('tx-page-num').innerText = `Page ${page} of ${Math.ceil(result.total / 10) || 1}`;
    currentTxPage = page;
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Transaction Details Page Controller ──────────────────────
async function loadTransactionDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const hash = urlParams.get('hash');
  if (!hash) {
    window.location.href = '/transactions.html';
    return;
  }

  showLoading('tx-details-container');
  try {
    const res = await fetch(`${API_BASE}/transactions/${hash}`);
    if (!res.ok) throw new Error('Transaction not found');
    const tx = await res.json();

    const container = document.getElementById('tx-details-container');
    const statusBadge = tx.status === 'SUCCESS' ? 'badge-success' : 'badge-danger';
    
    const toRow = tx.toAddress 
      ? `<a href="/wallet.html?address=${tx.toAddress}">${tx.toAddress}</a>` 
      : `Contract Creation: <a href="/contract.html?address=${tx.contractAddress}">${tx.contractAddress}</a>`;

    let tokenTransferRow = '';
    if (tx.tokenName || tx.tokenSymbol || tx.tokenAmount) {
      const amountStr = tx.tokenAmount ? Number(tx.tokenAmount).toLocaleString() : '0';
      tokenTransferRow = `
        <div class="detail-row" style="background: rgba(37, 99, 235, 0.05); border-left: 4px solid var(--primary); padding: 1.25rem 1rem;">
          <div class="detail-label" style="font-weight: 700;">Token Asset Movement</div>
          <div class="detail-value" style="font-weight: 600;">
            Transferred <span style="color: #60A5FA; font-family: monospace; font-size: 1.05rem;">${amountStr}</span> of 
            <span style="color: var(--primary); font-weight: 700;">${tx.tokenName} (${tx.tokenSymbol})</span>
          </div>
        </div>
      `;
    }

    const gasPriceGwei = tx.gasPrice ? (Number(tx.gasPrice) / 1e9).toFixed(4) + ' Gwei' : '0 Gwei';
    const totalGasFeeEth = tx.transactionFee ? formatWei(tx.transactionFee) : '0 ETH';
    const gasLimitVal = tx.gasLimit ? tx.gasLimit.toString() : 'N/A';

    container.innerHTML = `
      <div class="detail-card">
        <div class="detail-row">
          <div class="detail-label">Transaction Hash</div>
          <div class="detail-value font-mono" style="font-weight:600;">${tx.txHash}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Status</div>
          <div class="detail-value"><span class="badge ${statusBadge}">${tx.status}</span></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Block Number</div>
          <div class="detail-value"><a href="/block.html?number=${tx.blockNumber}" class="block-link">#${tx.blockNumber}</a></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Timestamp</div>
          <div class="detail-value">${formatTimestamp(tx.timestamp)} (${getRelativeTime(tx.timestamp)})</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">From Address</div>
          <div class="detail-value"><a href="/wallet.html?address=${tx.fromAddress}">${tx.fromAddress}</a></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">To / Contract</div>
          <div class="detail-value">${toRow}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Method (Signature)</div>
          <div class="detail-value"><span class="badge badge-gray">${tx.method}</span></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Value (Native)</div>
          <div class="detail-value">${formatWei(tx.value)}</div>
        </div>
        ${tokenTransferRow}
        <div class="detail-row">
          <div class="detail-label">Gas Limit</div>
          <div class="detail-value">${gasLimitVal} gas units</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Gas Used</div>
          <div class="detail-value">${tx.gasUsed} gas units (${tx.gasLimit ? (Number(tx.gasUsed) / Number(tx.gasLimit) * 100).toFixed(2) : 0}%)</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Gas Price</div>
          <div class="detail-value">${gasPriceGwei} <span style="color: var(--text-muted); font-size: 0.8rem;">(${tx.gasPrice ? Number(tx.gasPrice).toLocaleString() : 0} Wei)</span></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Total Gas Fee</div>
          <div class="detail-value" style="font-weight: 600; color: var(--warning);">${totalGasFeeEth}</div>
        </div>
      </div>

      <h3 style="margin-bottom:1rem;">Emitted Receipts Event Logs (${tx.logs.length})</h3>
      <div id="tx-logs-container"></div>
    `;

    const logsContainer = document.getElementById('tx-logs-container');
    if (tx.logs.length === 0) {
      logsContainer.innerHTML = '<div class="empty-state">No logs emitted in this transaction execution.</div>';
    } else {
      tx.logs.forEach((log, index) => {
        logsContainer.innerHTML += `
          <div class="detail-card" style="margin-bottom: 1rem; border-color: rgba(255,255,255,0.04);">
            <div style="font-weight:600; margin-bottom: 0.5rem; color: var(--primary);">Log #${index}</div>
            <div class="detail-row" style="padding: 0.5rem 0;">
              <div class="detail-label" style="width: 140px;">Address</div>
              <div class="detail-value"><a href="/contract.html?address=${log.address}">${log.address}</a></div>
            </div>
            <div class="detail-row" style="padding: 0.5rem 0;">
              <div class="detail-label" style="width: 140px;">Topics</div>
              <div class="detail-value"><pre class="raw-json" style="max-height:100px;">${JSON.stringify(JSON.parse(log.topics), null, 2)}</pre></div>
            </div>
            <div class="detail-row" style="padding: 0.5rem 0;">
              <div class="detail-label" style="width: 140px;">Data</div>
              <div class="detail-value font-mono" style="font-size:0.85rem; word-break: break-all;">${log.data}</div>
            </div>
          </div>
        `;
      });
    }
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Tracked Contracts Page Controller ────────────────────────
async function loadContractsList() {
  showLoading('contracts-table-body');
  try {
    const res = await fetch(`${API_BASE}/contracts`);
    if (!res.ok) throw new Error('Failed to load contracts');
    const list = await res.json();

    const body = document.getElementById('contracts-table-body');
    body.innerHTML = '';

    if (list.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="empty-state">No contracts tracked.</td></tr>';
      return;
    }

    list.forEach(c => {
      body.innerHTML += `
        <tr>
          <td style="font-weight: 600;">${c.name}</td>
          <td><a href="/contract.html?address=${c.address}" class="tx-hash">${c.address}</a></td>
          <td><span class="badge badge-info">${c.type}</span></td>
        </tr>
      `;
    });
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Contract Details Page Controller ─────────────────────────
async function loadContractDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const address = urlParams.get('address');
  if (!address) {
    window.location.href = '/contracts.html';
    return;
  }

  showLoading('contract-details-container');
  try {
    const res = await fetch(`${API_BASE}/contracts/${address}`);
    if (!res.ok) throw new Error('Contract not found in registry');
    const c = await res.json();

    const container = document.getElementById('contract-details-container');
    
    container.innerHTML = `
      <div class="detail-card">
        <div class="detail-row">
          <div class="detail-label">Contract Address</div>
          <div class="detail-value font-mono" style="font-weight: 700;">${c.contractAddress}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Label / Name</div>
          <div class="detail-value" style="font-weight: 600;">${c.name}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Type</div>
          <div class="detail-value"><span class="badge badge-info">${c.contractType}</span></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Total Local Transactions</div>
          <div class="detail-value">${c.totalTransactions} transactions</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Last Active Activity</div>
          <div class="detail-value">${c.lastActivity ? formatTimestamp(c.lastActivity) : 'No transactions recorded'}</div>
        </div>
      </div>

      <h3 style="margin-bottom:1rem;">Recent Decoded Event Logs (Last 10)</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Block</th>
              <th>Tx Hash</th>
              <th>Payload Arguments</th>
            </tr>
          </thead>
          <tbody id="contract-events-body"></tbody>
        </table>
      </div>
    `;

    const eventsBody = document.getElementById('contract-events-body');
    if (c.recentEvents.length === 0) {
      eventsBody.innerHTML = '<tr><td colspan="4" class="empty-state">No events recorded for this contract in ledger.</td></tr>';
    } else {
      c.recentEvents.forEach(e => {
        const payloadStr = typeof e.eventPayload === 'string' ? e.eventPayload : JSON.stringify(e.eventPayload);
        
        eventsBody.innerHTML += `
          <tr>
            <td><span class="badge badge-success">${e.eventName}</span></td>
            <td><a href="/block.html?number=${e.blockNumber}" class="block-link">#${e.blockNumber}</a></td>
            <td><a href="/transaction.html?hash=${e.txHash}" class="tx-hash">${formatAddress(e.txHash, 6)}</a></td>
            <td><pre class="raw-json" style="max-height:100px;">${JSON.stringify(JSON.parse(payloadStr), null, 2)}</pre></td>
          </tr>
        `;
      });
    }
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Wallet Page Controller ───────────────────────────────────
async function loadWalletDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const address = urlParams.get('address');
  if (!address) {
    window.location.href = '/dashboard.html';
    return;
  }

  showLoading('wallet-details-container');
  try {
    const res = await fetch(`${API_BASE}/wallets/${address}`);
    if (!res.ok) throw new Error('Failed to load wallet metrics');
    const w = await res.json();

    const container = document.getElementById('wallet-details-container');
    container.innerHTML = `
      <div class="stats-grid" style="margin-bottom: 1.5rem;">
        <div class="stat-card">
          <div class="stat-header">Wallet Balance (Estimated)</div>
          <div class="stat-value">$${w.portfolioValue.toLocaleString()} USD</div>
          <div class="stat-footer">Derived from read-model balances</div>
        </div>
        <div class="stat-card">
          <div class="stat-header">Unique Assets Owned</div>
          <div class="stat-value">${w.assetsOwned}</div>
        </div>
        <div class="stat-card">
          <div class="stat-header">Total Scanned Transactions</div>
          <div class="stat-value">${w.transactionsCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-header">Vault Interactions</div>
          <div class="stat-value" style="font-size: 1.15rem;">
            Deposits: <span style="color:var(--success); font-weight:700;">${w.vaultDeposits}</span> | 
            Withdraws: <span style="color:var(--danger); font-weight:700;">${w.vaultWithdrawals}</span>
          </div>
        </div>
      </div>

      <h3 style="margin-bottom: 1rem;">Asset Portfolio Holdings</h3>
      <div class="table-container" style="margin-bottom: 2rem;">
        <table>
          <thead>
            <tr>
              <th>Token / Vault Address</th>
              <th>Balance Shares</th>
            </tr>
          </thead>
          <tbody id="wallet-holdings-body"></tbody>
        </table>
      </div>

      <h3 style="margin-bottom: 1rem;">Recent Ledger Event Activity</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Contract / Token</th>
              <th>Block</th>
              <th>Tx Hash</th>
              <th>Event Parameters</th>
            </tr>
          </thead>
          <tbody id="wallet-history-body"></tbody>
        </table>
      </div>
    `;

    // Populate positions
    const holdingsBody = document.getElementById('wallet-holdings-body');
    if (w.positions.length === 0) {
      holdingsBody.innerHTML = '<tr><td colspan="2" class="empty-state">No token balances tracked in read model.</td></tr>';
    } else {
      w.positions.forEach(pos => {
        holdingsBody.innerHTML += `
          <tr>
            <td><a href="/asset.html?id=${pos.vaultAddress}" class="tx-hash">${pos.vaultAddress}</a></td>
            <td style="font-weight:600; font-family: monospace;">${Number(pos.shares).toLocaleString()}</td>
          </tr>
        `;
      });
    }

    // Populate events
    const historyBody = document.getElementById('wallet-history-body');
    if (w.recentEvents.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="5" class="empty-state">No contract logs involving this address found in local ledger.</td></tr>';
    } else {
      w.recentEvents.forEach(e => {
        const payloadStr = typeof e.eventPayload === 'string' ? e.eventPayload : JSON.stringify(e.eventPayload);
        
        historyBody.innerHTML += `
          <tr>
            <td><span class="badge badge-success">${e.eventName}</span></td>
            <td><a href="/contract.html?address=${e.contractAddress}" class="tx-hash">${formatAddress(e.contractAddress)}</a></td>
            <td><a href="/block.html?number=${e.blockNumber}" class="block-link">#${e.blockNumber}</a></td>
            <td><a href="/transaction.html?hash=${e.txHash}" class="tx-hash">${formatAddress(e.txHash, 6)}</a></td>
            <td><pre class="raw-json" style="max-height:100px;">${JSON.stringify(JSON.parse(payloadStr), null, 2)}</pre></td>
          </tr>
        `;
      });
    }
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Token Assets Page Controller ────────────────────────────
async function loadAssetsList() {
  showLoading('assets-table-body');
  try {
    const res = await fetch(`${API_BASE}/assets`);
    if (!res.ok) throw new Error('Failed to load assets');
    const list = await res.json();

    const body = document.getElementById('assets-table-body');
    body.innerHTML = '';

    if (list.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="empty-state">No assets index records.</td></tr>';
      return;
    }

    list.forEach(asset => {
      body.innerHTML += `
        <tr>
          <td style="font-weight: 600;">${asset.name}</td>
          <td><span class="badge badge-gray">${asset.symbol}</span></td>
          <td><a href="/asset.html?id=${asset.id}" class="tx-hash">${asset.id}</a></td>
          <td>${asset.holdersCount} active holders</td>
        </tr>
      `;
    });
  } catch (error) {
    showToast(error.message);
  }
}

// ─── Asset Token details Page Controller ──────────────────────
async function loadAssetDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  if (!id) {
    window.location.href = '/assets.html';
    return;
  }

  showLoading('asset-details-container');
  try {
    const res = await fetch(`${API_BASE}/assets/${id}`);
    if (!res.ok) throw new Error('Asset token not found in registry');
    const asset = await res.json();

    const container = document.getElementById('asset-details-container');
    container.innerHTML = `
      <div class="detail-card">
        <div class="detail-row">
          <div class="detail-label">Asset Token Address</div>
          <div class="detail-value font-mono" style="font-weight: 700;">${asset.id}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Token Name</div>
          <div class="detail-value" style="font-weight: 600;">${asset.name}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Token Symbol</div>
          <div class="detail-value"><span class="badge badge-gray">${asset.symbol}</span></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Total Shares Supply</div>
          <div class="detail-value font-mono">${Number(asset.totalSupply).toLocaleString()}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Holders Registered</div>
          <div class="detail-value">${asset.holdersCount} unique holders</div>
        </div>
      </div>

      <div class="dashboard-columns" style="margin-top: 1.5rem;">
        <div class="column-card" style="grid-column: 1 / -1;">
          <div class="column-header">
            <div class="column-title">Top Active Holders (Leaderboard / KYC / Investor Details)</div>
          </div>
          <div class="table-container" style="border:none; border-radius:0;">
            <table>
              <thead>
                <tr>
                  <th>Holder Wallet</th>
                  <th>KYC Status</th>
                  <th>Investor Role</th>
                  <th>Jurisdiction</th>
                  <th style="text-align:right;">Balance Shares</th>
                </tr>
              </thead>
              <tbody id="asset-holders-body"></tbody>
            </table>
          </div>
        </div>

        <div class="column-card" style="grid-column: 1 / -1;">
          <div class="column-header">
            <div class="column-title">Recent Token Transfer / Deposit / Withdraw Logs</div>
          </div>
          <div class="table-container" style="border:none; border-radius:0;">
            <table>
              <thead>
                <tr>
                  <th>Tx Hash</th>
                  <th>Block</th>
                  <th>Args</th>
                </tr>
              </thead>
              <tbody id="asset-transfers-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Render holders
    const holdersBody = document.getElementById('asset-holders-body');
    if (asset.holders.length === 0) {
      holdersBody.innerHTML = '<tr><td colspan="5" class="empty-state">No balances recorded.</td></tr>';
    } else {
      asset.holders.forEach(h => {
        const kycBadge = h.kycVerified
          ? '<span class="badge badge-success">Verified</span>'
          : '<span class="badge badge-gray">Unverified</span>';

        holdersBody.innerHTML += `
          <tr>
            <td><a href="/wallet.html?address=${h.holderAddress}" class="address-link">${formatAddress(h.holderAddress, 10)}</a></td>
            <td>${kycBadge}</td>
            <td><span class="badge badge-info">${h.role || 'Retail'}</span></td>
            <td><span class="badge badge-gray">Jurisdiction ${h.jurisdiction || 'Unknown'}</span></td>
            <td style="text-align:right; font-weight:700; font-family:monospace;">${Number(h.balance).toLocaleString()}</td>
          </tr>
        `;
      });
    }

    // Render transfers
    const transfersBody = document.getElementById('asset-transfers-body');
    if (asset.transfers.length === 0) {
      transfersBody.innerHTML = '<tr><td colspan="3" class="empty-state">No recent ledger events found.</td></tr>';
    } else {
      asset.transfers.forEach(t => {
        const payloadStr = typeof t.eventPayload === 'string' ? t.eventPayload : JSON.stringify(t.eventPayload);
        transfersBody.innerHTML += `
          <tr>
            <td><a href="/transaction.html?hash=${t.txHash}" class="tx-hash">${formatAddress(t.txHash, 6)}</a></td>
            <td><a href="/block.html?number=${t.blockNumber}" class="block-link">#${t.blockNumber}</a></td>
            <td><pre class="raw-json" style="max-height:85px; padding:0.5rem; font-size:0.8rem;">${JSON.stringify(JSON.parse(payloadStr), null, 2)}</pre></td>
          </tr>
        `;
      });
    }
  } catch (error) {
    showToast(error.message);
  }
}

// Router to identify page and run matching controllers
document.addEventListener('DOMContentLoaded', () => {
  initSearch();
  initSyncStatusPolling();

  const path = window.location.pathname;

  if (path === '/' || path.endsWith('/dashboard.html') || path.endsWith('/')) {
    loadDashboard();
  } else if (path.endsWith('/blocks.html')) {
    loadBlocksList(1);
    document.getElementById('blocks-prev').addEventListener('click', () => loadBlocksList(currentBlocksPage - 1));
    document.getElementById('blocks-next').addEventListener('click', () => loadBlocksList(currentBlocksPage + 1));
  } else if (path.endsWith('/block.html')) {
    loadBlockDetails();
  } else if (path.endsWith('/transactions.html')) {
    loadTransactionsList(1);
    document.getElementById('tx-prev').addEventListener('click', () => loadTransactionsList(currentTxPage - 1));
    document.getElementById('tx-next').addEventListener('click', () => loadTransactionsList(currentTxPage + 1));
  } else if (path.endsWith('/transaction.html')) {
    loadTransactionDetails();
  } else if (path.endsWith('/contracts.html')) {
    loadContractsList();
  } else if (path.endsWith('/contract.html')) {
    loadContractDetails();
  } else if (path.endsWith('/wallet.html')) {
    loadWalletDetails();
  } else if (path.endsWith('/assets.html')) {
    loadAssetsList();
  } else if (path.endsWith('/asset.html')) {
    loadAssetDetails();
  }
});
