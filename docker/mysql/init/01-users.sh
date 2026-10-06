#!/bin/bash
# Runs once, on first start of an empty MySQL volume.
# Creates two least-privilege users (see docs/decisions/ADR-004-security-baseline.md):
#   app      - what the service connects as. DML only: it can read and write rows but
#              cannot CREATE/ALTER/DROP anything, so even a successful injection can't drop tables.
#   migrator - used only by `prisma migrate`. DDL on the app schema plus a dedicated shadow
#              database (Prisma needs one to diff migrations), nothing else.
set -euo pipefail

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_shadow\`;

CREATE USER IF NOT EXISTS 'app'@'%' IDENTIFIED BY '${APP_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${MYSQL_DATABASE}\`.* TO 'app'@'%';

CREATE USER IF NOT EXISTS 'migrator'@'%' IDENTIFIED BY '${MIGRATOR_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO 'migrator'@'%';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_shadow\`.* TO 'migrator'@'%';

FLUSH PRIVILEGES;
SQL
