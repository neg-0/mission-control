#!/bin/bash
# Creates the test database and runs Prisma migrations against it.
# Idempotent: safe to run multiple times.
#
# Usage: npm run test:setup-db

set -euo pipefail

DB_NAME="mission_control_test"
DB_URL="postgresql://$(whoami)@localhost:5432/${DB_NAME}"

echo "Setting up test database: ${DB_NAME}"

# Create database if it doesn't exist
if psql -lqt | cut -d \| -f 1 | grep -qw "${DB_NAME}"; then
  echo "  Database '${DB_NAME}' already exists."
else
  createdb "${DB_NAME}"
  echo "  Created database '${DB_NAME}'."
fi

# Run Prisma migrations against the test database
DATABASE_URL="${DB_URL}" npx prisma migrate deploy 2>&1

echo "Test database '${DB_NAME}' is ready."
