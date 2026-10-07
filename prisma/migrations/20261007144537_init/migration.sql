-- CreateTable
CREATE TABLE `locations` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `region` VARCHAR(200) NULL,
    `country` VARCHAR(100) NULL,
    `country_code` CHAR(2) NULL,
    `latitude` DOUBLE NOT NULL,
    `longitude` DOUBLE NOT NULL,
    `elevation_m` DOUBLE NULL,
    `timezone` VARCHAR(64) NULL,
    `population` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geocode_queries` (
    `query_key` VARCHAR(120) NOT NULL,
    `location_ids` JSON NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`query_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forecast_snapshots` (
    `grid_key` VARCHAR(32) NOT NULL,
    `latitude` DOUBLE NOT NULL,
    `longitude` DOUBLE NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL,
    `marine_status` ENUM('AVAILABLE', 'NONE', 'UNAVAILABLE') NOT NULL,

    PRIMARY KEY (`grid_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_forecasts` (
    `grid_key` VARCHAR(32) NOT NULL,
    `date` DATE NOT NULL,
    `weather_code` INTEGER NOT NULL,
    `temperature_max_c` DOUBLE NOT NULL,
    `temperature_min_c` DOUBLE NOT NULL,
    `precipitation_sum_mm` DOUBLE NOT NULL,
    `precipitation_probability_max_pct` DOUBLE NULL,
    `snowfall_sum_cm` DOUBLE NOT NULL,
    `snow_depth_max_m` DOUBLE NULL,
    `wind_speed_max_kmh` DOUBLE NOT NULL,
    `wind_gusts_max_kmh` DOUBLE NOT NULL,
    `sunshine_duration_s` DOUBLE NULL,
    `uv_index_max` DOUBLE NULL,
    `wave_height_max_m` DOUBLE NULL,
    `wave_period_max_s` DOUBLE NULL,
    `swell_wave_height_max_m` DOUBLE NULL,

    PRIMARY KEY (`grid_key`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_forecasts` ADD CONSTRAINT `daily_forecasts_grid_key_fkey` FOREIGN KEY (`grid_key`) REFERENCES `forecast_snapshots`(`grid_key`) ON DELETE CASCADE ON UPDATE CASCADE;
