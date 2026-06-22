-- CreateTable
CREATE TABLE `blockchain_events` (
    `event_id` BIGINT NOT NULL AUTO_INCREMENT,
    `chain_id` INTEGER NOT NULL,
    `block_number` BIGINT NOT NULL,
    `block_hash` VARCHAR(191) NOT NULL,
    `parent_hash` VARCHAR(191) NOT NULL,
    `tx_hash` VARCHAR(191) NOT NULL,
    `log_index` INTEGER NOT NULL,
    `contract_address` VARCHAR(191) NOT NULL,
    `event_name` VARCHAR(191) NOT NULL,
    `event_version` VARCHAR(191) NOT NULL DEFAULT '1.0',
    `event_payload` JSON NOT NULL,
    `is_removed` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `blockchain_events_status_idx`(`status`),
    INDEX `blockchain_events_block_number_idx`(`block_number`),
    INDEX `blockchain_events_contract_address_idx`(`contract_address`),
    UNIQUE INDEX `blockchain_events_tx_hash_log_index_key`(`tx_hash`, `log_index`),
    PRIMARY KEY (`event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `processed_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` BIGINT NOT NULL,
    `projection_name` VARCHAR(191) NOT NULL,
    `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `processed_events_event_id_projection_name_key`(`event_id`, `projection_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `indexed_blocks` (
    `block_number` BIGINT NOT NULL,
    `block_hash` VARCHAR(191) NOT NULL,
    `parent_hash` VARCHAR(191) NOT NULL,
    `indexed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'synced',

    PRIMARY KEY (`block_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projection_state` (
    `projection_name` VARCHAR(191) NOT NULL,
    `last_event_id` BIGINT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`projection_name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dead_letter_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` BIGINT NOT NULL,
    `projection_name` VARCHAR(191) NOT NULL,
    `error_message` TEXT NOT NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_metrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `metric_name` VARCHAR(191) NOT NULL,
    `metric_value` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sync_metrics_metric_name_key`(`metric_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_positions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wallet_address` VARCHAR(191) NOT NULL,
    `vault_address` VARCHAR(191) NOT NULL,
    `shares` DECIMAL(30, 18) NOT NULL,
    `last_updated_block` BIGINT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portfolio_positions_wallet_address_vault_address_key`(`wallet_address`, `vault_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vaults` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vault_address` VARCHAR(191) NOT NULL,
    `asset_address` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `vault_type` VARCHAR(191) NOT NULL,
    `creator` VARCHAR(191) NOT NULL,
    `tvl` DECIMAL(30, 18) NOT NULL DEFAULT 0,
    `total_shares` DECIMAL(30, 18) NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vaults_vault_address_key`(`vault_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vault_address` VARCHAR(191) NOT NULL,
    `fee_type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(30, 18) NOT NULL,
    `recipient` VARCHAR(191) NULL,
    `tx_hash` VARCHAR(191) NOT NULL,
    `block_number` BIGINT NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vault_address` VARCHAR(191) NOT NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `investor` VARCHAR(191) NOT NULL,
    `shares` DECIMAL(30, 18) NOT NULL,
    `assets` DECIMAL(30, 18) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `request_time` DATETIME(3) NOT NULL,
    `settle_time` DATETIME(3) NULL,
    `tx_hash` VARCHAR(191) NOT NULL,
    `block_number` BIGINT NOT NULL,

    UNIQUE INDEX `settlements_vault_address_request_id_key`(`vault_address`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nav_submissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` VARCHAR(191) NOT NULL,
    `nav_value` DECIMAL(30, 18) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `submitter` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `valuation_date` DATETIME(3) NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL,
    `tx_hash` VARCHAR(191) NOT NULL,
    `block_number` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `token_holders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token_address` VARCHAR(191) NOT NULL,
    `holder_address` VARCHAR(191) NOT NULL,
    `balance` DECIMAL(30, 18) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `token_holders_token_address_holder_address_key`(`token_address`, `holder_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `protocol_metrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tvl` DECIMAL(30, 18) NOT NULL DEFAULT 0,
    `total_fees` DECIMAL(30, 18) NOT NULL DEFAULT 0,
    `active_vaults` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
