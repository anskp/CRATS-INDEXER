-- CreateTable
CREATE TABLE `blocks` (
    `block_number` BIGINT NOT NULL,
    `block_hash` VARCHAR(191) NOT NULL,
    `parent_hash` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,
    `gas_used` BIGINT NOT NULL,
    `tx_count` INTEGER NOT NULL,

    PRIMARY KEY (`block_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `tx_hash` VARCHAR(191) NOT NULL,
    `block_number` BIGINT NOT NULL,
    `from_address` VARCHAR(191) NOT NULL,
    `to_address` VARCHAR(191) NULL,
    `contract_address` VARCHAR(191) NULL,
    `method` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `gas_used` BIGINT NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,

    INDEX `transactions_block_number_idx`(`block_number`),
    INDEX `transactions_from_address_idx`(`from_address`),
    INDEX `transactions_to_address_idx`(`to_address`),
    PRIMARY KEY (`tx_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tx_hash` VARCHAR(191) NOT NULL,
    `log_index` INTEGER NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `topics` TEXT NOT NULL,
    `data` TEXT NOT NULL,
    `block_number` BIGINT NOT NULL,

    UNIQUE INDEX `logs_tx_hash_log_index_key`(`tx_hash`, `log_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_status` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chain_id` INTEGER NOT NULL,
    `last_synced_block` BIGINT NOT NULL,
    `latest_block` BIGINT NOT NULL,
    `progress_percentage` DECIMAL(5, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sync_status_chain_id_key`(`chain_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `failed_blocks` (
    `block_number` BIGINT NOT NULL,
    `error` TEXT NOT NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`block_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
