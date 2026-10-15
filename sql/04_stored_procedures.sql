-- ============================================================================
-- RideSync - Global Ride-Hailing Network
-- 04_stored_procedures.sql: Workflow 1 - Atomic Transaction Stored Procedure
-- ============================================================================

-- Procedure: sp_book_trip_atomic
-- Purpose: Atomically books a trip by:
--   1. Checking vehicle active status
--   2. Verifying and debiting rider wallet balance (triggering wallet audit log)
--   3. Creating the trip entry in 'REQUESTED' state
--   4. Catching any failure, logging it, and rolling back the whole transaction
--
-- Isolation note: we use SELECT ... FOR UPDATE to take a row-level lock on the
-- rider being debited, rather than relying solely on REPEATABLE READ isolation.
-- This prevents two concurrent bookings for the same rider from both reading
-- a stale balance and both succeeding when only one should. It is a stricter
-- guarantee than REPEATABLE READ alone would give for this read-then-write
-- pattern, so it is used here in place of (not in addition to) that isolation
-- level. Document this choice in the README.
--
-- [A1B changes - see docs/handover_note.md]
--  * Fare must be > 0. Previously a fare of 0.00 created an active trip with
--    no wallet movement (so no audit row), and a negative fare *credited* the
--    wallet before the trips CHECK constraint rolled it back.
--  * Each business failure now raises a distinct SQLSTATE so the API can show
--    a precise, friendly message without parsing English text:
--        RS001 insufficient balance      RS002 vehicle inactive / missing
--        RS003 rider missing             RS004 invalid fare
--    The "second active trip" case is still left to the partial unique index
--    idx_active_rider_trip (SQLSTATE 23505), exactly as in Assignment 1.
--  * The trip id is generated before the debit and passed to the audit
--    trigger (ridesync.audit_ref) so the audit row points at the booking.
--  * The signature (p_rider_id, p_vehicle_id, p_fare_amount, OUT p_trip_id)
--    is unchanged, so the README example still works.
CREATE OR REPLACE PROCEDURE sp_book_trip_atomic(
    p_rider_id UUID,
    p_vehicle_id UUID,
    p_fare_amount NUMERIC(10, 2),
    OUT p_trip_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_balance NUMERIC(10, 2);
    v_vehicle_active BOOLEAN;
BEGIN
    -- 0. Validate input
    IF p_fare_amount IS NULL OR p_fare_amount <= 0 THEN
        RAISE EXCEPTION 'Fare must be greater than zero (got %).', p_fare_amount
            USING ERRCODE = 'RS004';
    END IF;

    -- 1. Check vehicle availability
    SELECT is_active INTO v_vehicle_active FROM vehicles WHERE id = p_vehicle_id;
    IF v_vehicle_active IS NULL OR v_vehicle_active = FALSE THEN
        RAISE EXCEPTION 'Vehicle % is inactive or does not exist.', p_vehicle_id
            USING ERRCODE = 'RS002';
    END IF;

    -- 2. Lock and verify rider balance
    SELECT wallet_balance INTO v_current_balance
    FROM riders
    WHERE id = p_rider_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RAISE EXCEPTION 'Rider % does not exist.', p_rider_id
            USING ERRCODE = 'RS003';
    END IF;

    IF v_current_balance < p_fare_amount THEN
        RAISE EXCEPTION 'Insufficient balance: current %, required %', v_current_balance, p_fare_amount
            USING ERRCODE = 'RS001';
    END IF;

    -- 3. Generate the trip id first so the audit row can reference it
    p_trip_id := gen_random_uuid();

    -- 4. Deduct fare into escrow (this triggers trg_audit_wallet_balance)
    PERFORM set_config('ridesync.audit_reason', 'TRIP_ESCROW_DEBIT', true);
    PERFORM set_config('ridesync.audit_ref', p_trip_id::TEXT, true);

    UPDATE riders
    SET wallet_balance = wallet_balance - p_fare_amount
    WHERE id = p_rider_id;

    PERFORM set_config('ridesync.audit_reason', '', true);
    PERFORM set_config('ridesync.audit_ref', '', true);

    -- 5. Insert trip record (idx_active_rider_trip blocks a 2nd active trip)
    INSERT INTO trips (
        id,
        rider_id,
        vehicle_id,
        fare_amount,
        status,
        created_at
    ) VALUES (
        p_trip_id,
        p_rider_id,
        p_vehicle_id,
        p_fare_amount,
        'REQUESTED',
        CURRENT_TIMESTAMP
    );

    -- Commit happens automatically at the end of the procedure invocation

EXCEPTION
    WHEN OTHERS THEN
        -- Explicitly surface and roll back on any failure above: inactive
        -- vehicle, missing rider, insufficient balance, or a CHECK constraint
        -- violation. RAISE re-throws after logging so the caller still sees
        -- the original error (and SQLSTATE) and the calling transaction is
        -- rolled back.
        RAISE NOTICE 'Booking failed for rider % / vehicle %: %', p_rider_id, p_vehicle_id, SQLERRM;
        p_trip_id := NULL;
        RAISE;
END;
$$;
