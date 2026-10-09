-- Store each search as two columns (name + country_code) instead of one "name|country" string.
-- geocode_queries only holds saved search results, so rebuilding it is safe: searches are simply
-- looked up on Open-Meteo again and saved in the new format.
DROP TABLE `geocode_queries`;

CREATE TABLE `geocode_queries` (
    `name` VARCHAR(120) NOT NULL,
    `country_code` VARCHAR(2) NOT NULL,
    `location_ids` JSON NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`name`, `country_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
