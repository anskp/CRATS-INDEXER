import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to hardhat artifacts in CRATS-EVM
const ARTIFACTS_BASE_PATH = path.resolve(__dirname, '../../../CRATS-EVM/artifacts/contracts');
const OZ_ARTIFACTS_BASE_PATH = path.resolve(__dirname, '../../../CRATS-EVM/artifacts/@openzeppelin');

function loadAbi(relativePath, isOz = false) {
  const basePath = isOz ? OZ_ARTIFACTS_BASE_PATH : ARTIFACTS_BASE_PATH;
  const fullPath = path.join(basePath, relativePath);
  try {
    if (!fs.existsSync(fullPath)) {
      logger.warn(`ABI artifact not found at: ${fullPath}`);
      return [];
    }
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return data.abi || [];
  } catch (error) {
    logger.error(`Error loading ABI from ${fullPath}:`, error);
    return [];
  }
}

// Mapped contract inventory ABIs
export const IdentityRegistryABI = loadAbi('identity/IdentityRegistry.sol/IdentityRegistry.json');
export const IdentitySBTABI = loadAbi('identity/IdentitySBT.sol/IdentitySBT.json');
export const KYCRegistryABI = loadAbi('identity/KYCProvidersRegistry.sol/KYCProvidersRegistry.json');
export const ComplianceModuleABI = loadAbi('compliance/Compliance.sol/Compliance.json');
export const TravelRuleModuleABI = loadAbi('compliance/TravelRuleModule.sol/TravelRuleModule.json');
export const InvestorRightsRegistryABI = loadAbi('identity/InvestorRightsRegistry.sol/InvestorRightsRegistry.json');
export const CircuitBreakerABI = loadAbi('compliance/CircuitBreakerModule.sol/CircuitBreakerModule.json');
export const AssetFactoryABI = loadAbi('asset/AssetFactory.sol/AssetFactory.json');
export const AssetRegistryABI = loadAbi('asset/AssetRegistry.sol/AssetRegistry.json');
export const RealEstatePluginABI = loadAbi('asset/plugins/RealEstatePlugin.sol/RealEstatePlugin.json');
export const SyncVaultABI = loadAbi('vault/SyncVault.sol/SyncVault.json');
export const AsyncVaultABI = loadAbi('vault/AsyncVault.sol/AsyncVault.json');
export const VaultFactoryABI = loadAbi('financial/VaultFactory.sol/VaultFactory.json');
export const YieldDistributorABI = loadAbi('financial/YieldDistributor.sol/YieldDistributor.json');
export const FeeEngineABI = loadAbi('financial/FeeEngine.sol/FeeEngine.json');
export const NAVOracleABI = loadAbi('market/NAVOracle.sol/NAVOracle.json');
export const PriceOracleABI = loadAbi('market/PriceOracle.sol/PriceOracle.json');
export const MarketplaceFactoryABI = loadAbi('market/MarketplaceFactory.sol/MarketplaceFactory.json');
export const OrderBookEngineABI = loadAbi('market/OrderBookEngine.sol/OrderBookEngine.json');
export const SettlementEngineABI = loadAbi('market/SettlementEngine.sol/SettlementEngine.json');
export const ClearingHouseABI = loadAbi('market/ClearingHouse.sol/ClearingHouse.json');
export const TimelockABI = loadAbi('contracts/governance/TimelockController.sol/TimelockController.json', true);

// Standard ERC-20 ABI events
export const ERC20ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' }
    ],
    name: 'Transfer',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'owner', type: 'address' },
      { indexed: true, name: 'spender', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' }
    ],
    name: 'Approval',
    type: 'event'
  }
];

export const ABIMap = {
  [process.env.IDENTITY_REGISTRY?.toLowerCase()]: IdentityRegistryABI,
  [process.env.IDENTITY_SBT?.toLowerCase()]: IdentitySBTABI,
  [process.env.KYC_REGISTRY?.toLowerCase()]: KYCRegistryABI,
  [process.env.COMPLIANCE_MODULE?.toLowerCase()]: ComplianceModuleABI,
  [process.env.TRAVEL_RULE_MODULE?.toLowerCase()]: TravelRuleModuleABI,
  [process.env.INVESTOR_RIGHTS_REGISTRY?.toLowerCase()]: InvestorRightsRegistryABI,
  [process.env.CIRCUIT_BREAKER?.toLowerCase()]: CircuitBreakerABI,
  [process.env.ASSET_FACTORY?.toLowerCase()]: AssetFactoryABI,
  [process.env.ASSET_REGISTRY?.toLowerCase()]: AssetRegistryABI,
  [process.env.REAL_ESTATE_PLUGIN?.toLowerCase()]: RealEstatePluginABI,
  [process.env.VAULT_FACTORY?.toLowerCase()]: VaultFactoryABI,
  [process.env.YIELD_DISTRIBUTOR?.toLowerCase()]: YieldDistributorABI,
  [process.env.FEE_ENGINE?.toLowerCase()]: FeeEngineABI,
  [process.env.NAV_ORACLE?.toLowerCase()]: NAVOracleABI,
  [process.env.PRICE_ORACLE?.toLowerCase()]: PriceOracleABI,
  [process.env.MARKETPLACE_FACTORY?.toLowerCase()]: MarketplaceFactoryABI,
  [process.env.ORDER_BOOK_ENGINE?.toLowerCase()]: OrderBookEngineABI,
  [process.env.SETTLEMENT_ENGINE?.toLowerCase()]: SettlementEngineABI,
  [process.env.CLEARING_HOUSE?.toLowerCase()]: ClearingHouseABI,
  [process.env.TIMELOCK?.toLowerCase()]: TimelockABI,
  [process.env.USDC?.toLowerCase()]: ERC20ABI,
  [process.env.USDT?.toLowerCase()]: ERC20ABI
};

logger.info('Contract ABIs registry loaded successfully.');
