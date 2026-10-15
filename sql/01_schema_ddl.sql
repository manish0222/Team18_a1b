-- ============================================================================
-- RideSync - Global Ride-Hailing Network
-- 01_schema_ddl.sql: Tables, Data Types, Primary & Foreign Keys, CHECK Constraints
-- ============================================================================

-- Ensure pgcrypto or uuid-ossp extension is enabled for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop tables if exists in reverse dependency order
DROP TABLE IF EXISTS trips CASCADE;
DROP TABLE IF EXISTS wallet_audit_logs CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TABLE IF EXISTS riders CASCADE;

-- 1. Riders Table
-- Stores user identity and current wallet balance with non-negative CHECK constraint.
CREATE TABLE riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    wallet_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Wallet Audit Logs Table
-- Immutable ledger recording every balance modification triggered on riders.
CREATE TABLE wallet_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    amount_changed NUMERIC(10, 2) NOT NULL,
    action_type VARCHAR(50) NOT NULL, -- 'TOPUP', 'TRIP_ESCROW_DEBIT', 'TRIP_REFUND', 'ADJUSTMENT'
    balance_before NUMERIC(10, 2) NOT NULL,
    balance_after NUMERIC(10, 2) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- [A1B change] Optional link to the trip that caused this wallet movement
    -- (escrow debit / refund). Filled by the trigger from a transaction-local
    -- setting so the UI can show "this audit row belongs to this booking".
    -- No FK because trips is created after this table and audit rows must
    -- survive even if a trip were ever archived.
    reference_trip_id UUID
);

-- 3. Vehicles Table
-- Master record of all registered driver vehicles in the platform.
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_plate VARCHAR(50) UNIQUE NOT NULL,
    class VARCHAR(50) NOT NULL CHECK (class IN ('Standard', 'Comfort', 'XL', 'Executive', 'Black')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Trips Table
-- Stores ride bookings, fares, vehicle assignments, and real-time state
CREATE TABLE trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    fare_amount NUMERIC(10, 2) NOT NULL CHECK (fare_amount >= 0.00),
    status VARCHAR(50) NOT NULL CHECK (status IN ('REQUESTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);
