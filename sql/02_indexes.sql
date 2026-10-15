-- ============================================================================
-- RideSync - Global Ride-Hailing Network
-- 02_indexes.sql: Partial Indexes, Foreign Key Indexes, & Query Optimization
-- ============================================================================

-- 1. Partial Unique Index: Active Rider Trip Constraint
-- Guarantees at storage-engine level that a rider cannot be in multiple active rides simultaneously.
DROP INDEX IF EXISTS idx_active_rider_trip;
CREATE UNIQUE INDEX idx_active_rider_trip 
ON trips (rider_id) 
WHERE status IN ('REQUESTED', 'IN_TRANSIT');

-- 2. Foreign Key & Analytics Supporting Indexes
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_id_status ON trips (vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips (created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_audit_rider_timestamp ON wallet_audit_logs (rider_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_is_active ON vehicles (is_active);

-- 3. [A1B change] Rider trip history. The only index on trips.rider_id was the
-- partial unique index (active trips only), so "show this rider's trips"
-- (rider detail page, trips browse filtered by rider) was a sequential scan
-- over 100k rows.
CREATE INDEX IF NOT EXISTS idx_trips_rider_created ON trips (rider_id, created_at DESC);

-- 4. [A1B change] Audit rows for a given booking (shown after checkout).
CREATE INDEX IF NOT EXISTS idx_wallet_audit_reference_trip ON wallet_audit_logs (reference_trip_id)
WHERE reference_trip_id IS NOT NULL;
