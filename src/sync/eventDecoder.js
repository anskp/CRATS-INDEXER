import { decodeEventLog } from 'viem';
import logger from '../config/logger.js';
import * as ABIs from '../config/contractABIs.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Registry mapping contract address (lowercase) to its ABI
const contractABIRegistry = new Map();
// Registry mapping contract address (lowercase) to its label
const contractLabelRegistry = new Map();

// Helper to register static contracts from environment variables or deployment config
export function initializeABIRegistry() {
  const mappings = [
    { envKey: 'IDENTITY_REGISTRY', label: 'IdentityRegistry', abi: ABIs.IdentityRegistryABI },
    { envKey: 'IDENTITY_SBT', label: 'IdentitySBT', abi: ABIs.IdentitySBTABI },
    { envKey: 'KYC_REGISTRY', label: 'KYCRegistry', abi: ABIs.KYCRegistryABI },
    { envKey: 'COMPLIANCE_MODULE', label: 'ComplianceModule', abi: ABIs.ComplianceModuleABI },
    { envKey: 'TRAVEL_RULE_MODULE', label: 'TravelRuleModule', abi: ABIs.TravelRuleModuleABI },
    { envKey: 'INVESTOR_RIGHTS_REGISTRY', label: 'InvestorRightsRegistry', abi: ABIs.InvestorRightsRegistryABI },
    { envKey: 'CIRCUIT_BREAKER', label: 'CircuitBreaker', abi: ABIs.CircuitBreakerABI },
    { envKey: 'ASSET_FACTORY', label: 'AssetFactory', abi: ABIs.AssetFactoryABI },
    { envKey: 'ASSET_REGISTRY', label: 'AssetRegistry', abi: ABIs.AssetRegistryABI },
    { envKey: 'REAL_ESTATE_PLUGIN', label: 'RealEstatePlugin', abi: ABIs.RealEstatePluginABI },
    { envKey: 'VAULT_FACTORY', label: 'VaultFactory', abi: ABIs.VaultFactoryABI },
    { envKey: 'YIELD_DISTRIBUTOR', label: 'YieldDistributor', abi: ABIs.YieldDistributorABI },
    { envKey: 'USDC', label: 'USDC', abi: ABIs.ERC20ABI },
    { envKey: 'USDT', label: 'USDT', abi: ABIs.ERC20ABI },
    { envKey: 'FEE_ENGINE', label: 'FeeEngine', abi: ABIs.FeeEngineABI },
    { envKey: 'NAV_ORACLE', label: 'NAVOracle', abi: ABIs.NAVOracleABI },
    { envKey: 'PRICE_ORACLE', label: 'PriceOracle', abi: ABIs.PriceOracleABI },
    { envKey: 'MARKETPLACE_FACTORY', label: 'MarketplaceFactory', abi: ABIs.MarketplaceFactoryABI },
    { envKey: 'ORDER_BOOK_ENGINE', label: 'OrderBookEngine', abi: ABIs.OrderBookEngineABI },
    { envKey: 'SETTLEMENT_ENGINE', label: 'SettlementEngine', abi: ABIs.SettlementEngineABI },
    { envKey: 'CLEARING_HOUSE', label: 'ClearingHouse', abi: ABIs.ClearingHouseABI },
    { envKey: 'TIMELOCK', label: 'Timelock', abi: ABIs.TimelockABI },
    { envKey: 'REDEMPTION_MANAGER', label: 'RedemptionManager', abi: ABIs.RedemptionManagerABI },
    { envKey: 'DMS_REGISTRY', label: 'DMSRegistry', abi: ABIs.DMSRegistryABI },
    { envKey: 'SYNC_MANAGER', label: 'SyncManager', abi: ABIs.SyncManagerABI },
    { envKey: 'CARBON_CREDIT_PLUGIN', label: 'CarbonCreditPlugin', abi: ABIs.CarbonCreditPluginABI },
    { envKey: 'CARBON_RETIREMENT_PLUGIN', label: 'CarbonRetirementPlugin', abi: ABIs.CarbonRetirementPluginABI },
    { envKey: 'FINE_ART_PLUGIN', label: 'FineArtPlugin', abi: ABIs.FineArtPluginABI },
    { envKey: 'CARBON_METADATA_STORE', label: 'CarbonMetadataStore', abi: ABIs.CarbonMetadataStoreABI },
    { envKey: 'CARBON_BATCH_MANAGER', label: 'CarbonBatchManager', abi: ABIs.CarbonBatchManagerABI },
    { envKey: 'CARBON_RETIREMENT_MANAGER', label: 'CarbonRetirementManager', abi: ABIs.CarbonRetirementManagerABI },
    { envKey: 'GOVERNANCE_MULTISIG', label: 'GovernanceMultisig', abi: ABIs.GovernanceMultisigABI },
    { envKey: 'LIFECYCLE_EXIT_MANAGER', label: 'LifecycleExitManager', abi: ABIs.LifecycleExitManagerABI }
  ];

  // Try loading Sepolia deployment JSON directly
  const deploymentPath = path.resolve(__dirname, '../../../CRATS-EVM/deployments/sepolia-deployment.json');
  if (fs.existsSync(deploymentPath)) {
    try {
      logger.info(`Loading contract addresses from Sepolia deployment config: ${deploymentPath}`);
      const data = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      const contracts = data.contracts || {};

      const deployKeysMapping = {
        identityRegistry: { label: 'IdentityRegistry', abi: ABIs.IdentityRegistryABI },
        identitySBT: { label: 'IdentitySBT', abi: ABIs.IdentitySBTABI },
        kycRegistry: { label: 'KYCRegistry', abi: ABIs.KYCRegistryABI },
        complianceModule: { label: 'ComplianceModule', abi: ABIs.ComplianceModuleABI },
        travelRuleModule: { label: 'TravelRuleModule', abi: ABIs.TravelRuleModuleABI },
        investorRightsRegistry: { label: 'InvestorRightsRegistry', abi: ABIs.InvestorRightsRegistryABI },
        circuitBreaker: { label: 'CircuitBreaker', abi: ABIs.CircuitBreakerABI },
        assetFactory: { label: 'AssetFactory', abi: ABIs.AssetFactoryABI },
        assetRegistry: { label: 'AssetRegistry', abi: ABIs.AssetRegistryABI },
        realEstatePlugin: { label: 'RealEstatePlugin', abi: ABIs.RealEstatePluginABI },
        vaultFactory: { label: 'VaultFactory', abi: ABIs.VaultFactoryABI },
        yieldDistributor: { label: 'YieldDistributor', abi: ABIs.YieldDistributorABI },
        feeEngine: { label: 'FeeEngine', abi: ABIs.FeeEngineABI },
        navOracle: { label: 'NAVOracle', abi: ABIs.NAVOracleABI },
        priceOracle: { label: 'PriceOracle', abi: ABIs.PriceOracleABI },
        marketplaceFactory: { label: 'MarketplaceFactory', abi: ABIs.MarketplaceFactoryABI },
        orderBookEngine: { label: 'OrderBookEngine', abi: ABIs.OrderBookEngineABI },
        settlementEngine: { label: 'SettlementEngine', abi: ABIs.SettlementEngineABI },
        clearingHouse: { label: 'ClearingHouse', abi: ABIs.ClearingHouseABI },
        timelock: { label: 'Timelock', abi: ABIs.TimelockABI },
        redemptionManager: { label: 'RedemptionManager', abi: ABIs.RedemptionManagerABI },
        dmsRegistry: { label: 'DMSRegistry', abi: ABIs.DMSRegistryABI },
        syncManager: { label: 'SyncManager', abi: ABIs.SyncManagerABI },
        carbonCreditPlugin: { label: 'CarbonCreditPlugin', abi: ABIs.CarbonCreditPluginABI },
        carbonRetirementPlugin: { label: 'CarbonRetirementPlugin', abi: ABIs.CarbonRetirementPluginABI },
        fineArtPlugin: { label: 'FineArtPlugin', abi: ABIs.FineArtPluginABI },
        carbonMetadataStore: { label: 'CarbonMetadataStore', abi: ABIs.CarbonMetadataStoreABI },
        carbonBatchManager: { label: 'CarbonBatchManager', abi: ABIs.CarbonBatchManagerABI },
        carbonRetirementManager: { label: 'CarbonRetirementManager', abi: ABIs.CarbonRetirementManagerABI },
        governanceMultisig: { label: 'GovernanceMultisig', abi: ABIs.GovernanceMultisigABI },
        lifecycleExitManager: { label: 'LifecycleExitManager', abi: ABIs.LifecycleExitManagerABI },
        usdc: { label: 'USDC', abi: ABIs.ERC20ABI },
        usdt: { label: 'USDT', abi: ABIs.ERC20ABI }
      };

      Object.entries(contracts).forEach(([key, val]) => {
        if (typeof val === 'string' && val.startsWith('0x')) {
          const mapping = deployKeysMapping[key];
          if (mapping) {
            registerContract(val, mapping.abi, mapping.label);
          } else {
            logger.debug(`Contract key ${key} from deployment config has no registered ABI.`);
          }
        }
      });
      return;
    } catch (err) {
      logger.warn(`Error parsing Sepolia deployment file: ${err.message}. Falling back to .env.`);
    }
  } else {
    logger.warn(`Sepolia deployment file not found at ${deploymentPath}. Falling back to .env.`);
  }

  // Fallback to environment variables
  for (const item of mappings) {
    const address = process.env[item.envKey];
    if (address) {
      registerContract(address, item.abi, item.label);
    } else {
      logger.warn(`Static contract address for ${item.envKey} not configured in .env`);
    }
  }
}

export function getTrackedAddresses() {
  return Array.from(contractABIRegistry.keys());
}

export function registerContract(address, abi, label) {
  const cleanAddr = address.toLowerCase();
  contractABIRegistry.set(cleanAddr, abi);
  contractLabelRegistry.set(cleanAddr, label);
  logger.info(`Registered contract: ${label} @ ${address}`);
}

export function isTracked(address) {
  return contractABIRegistry.has(address.toLowerCase());
}

export function getLabel(address) {
  return contractLabelRegistry.get(address.toLowerCase()) || 'Unknown';
}

/**
 * Decodes a raw transaction log.
 * If successful, returns the decoded event object; otherwise returns null.
 */
export function decodeLog(log) {
  const address = log.address.toLowerCase();
  const abi = contractABIRegistry.get(address);

  if (!abi) {
    // If not registered, we can't decode it
    return null;
  }

  try {
    const decoded = decodeEventLog({
      abi,
      data: log.data,
      topics: log.topics,
    });

    return {
      eventName: decoded.eventName,
      args: decoded.args,
      contractLabel: contractLabelRegistry.get(address)
    };
  } catch (error) {
    // In some cases, a contract implements multiple ABIs (like ERC20 + Vault specific events).
    // Let's try parsing with SyncVault / AsyncVault ABIs as a fallback if it's a Vault.
    if (contractLabelRegistry.get(address)?.includes('Vault')) {
      try {
        const decoded = decodeEventLog({
          abi: ABIs.SyncVaultABI,
          data: log.data,
          topics: log.topics,
        });
        return {
          eventName: decoded.eventName,
          args: decoded.args,
          contractLabel: contractLabelRegistry.get(address)
        };
      } catch (e1) {
        try {
          const decoded = decodeEventLog({
            abi: ABIs.AsyncVaultABI,
            data: log.data,
            topics: log.topics,
          });
          return {
            eventName: decoded.eventName,
            args: decoded.args,
            contractLabel: contractLabelRegistry.get(address)
          };
        } catch (e2) {
          // Fail silently
        }
      }
    }
    logger.debug(`Failed to decode log for ${address}: ${error.message}`);
    return null;
  }
}
