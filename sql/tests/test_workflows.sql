-- ============================================================================
-- RideSync - Assignment 1B
-- sql/tests/test_workflows.sql - database-level tests for the objects the UI
-- relies on. Runs inside a transaction that is ROLLED BACK at the end, so it
-- never changes your seeded data.
--
--   psql -U postgres -d ridesync_db -v ON_ERROR_STOP=1 -f sql/tests/test_workflows.sql
--
-- Each block prints "PASS: ..." or aborts with an assertion error.
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

-- Fixtures: a fresh rider and vehicles so tests don't depend on random data
INSERT INTO riders (id, name, email, wallet_balance)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Test Rider', 'test.rider@a1b.local', 100.00);
INSERT INTO vehicles (id, license_plate, class, is_active) VALUES
    ('00000000-0000-0000-0000-0000000000b1', 'TEST-0001-AA', 'Standard', TRUE),
    ('00000000-0000-0000-0000-0000000000b2', 'TEST-0002-AA', 'XL', FALSE);

-- 1. Successful booking: balance debited, trip REQUESTED, trigger wrote audit row
DO $$
DECLARE v_trip UUID; v_bal NUMERIC; v_audit RECORD;
BEGIN
    CALL sp_book_trip_atomic('00000000-0000-0000-0000-0000000000a1',
                             '00000000-0000-0000-0000-0000000000b1', 30.00, v_trip);
    SELECT wallet_balance INTO v_bal FROM riders WHERE id = '00000000-0000-0000-0000-0000000000a1';
    ASSERT v_bal = 70.00, format('expected 70.00 after booking, got %s', v_bal);
    ASSERT (SELECT status FROM trips WHERE id = v_trip) = 'REQUESTED', 'trip should be REQUESTED';

    SELECT * INTO v_audit FROM wallet_audit_logs WHERE reference_trip_id = v_trip;
    ASSERT v_audit.action_type = 'TRIP_ESCROW_DEBIT', 'audit action should be TRIP_ESCROW_DEBIT';
    ASSERT v_audit.amount_changed = -30.00 AND v_audit.balance_before = 100.00
           AND v_audit.balance_after = 70.00, 'audit amounts wrong';
    RAISE NOTICE 'PASS: booking debits wallet and trigger logs TRIP_ESCROW_DEBIT for the trip';
END $$;

-- 2. updated_at now moves when the balance changes (A1 trigger bug fixed)
DO $$
BEGIN
    -- created_at = transaction start (CURRENT_TIMESTAMP); the BEFORE trigger
    -- stamps clock_timestamp(), which is strictly later. With the original
    -- AFTER-trigger code these two values stayed equal.
    ASSERT (SELECT updated_at > created_at FROM riders
            WHERE id = '00000000-0000-0000-0000-0000000000a1'),
           'updated_at not maintained';
    RAISE NOTICE 'PASS: riders.updated_at is maintained by the BEFORE trigger';
END $$;

-- 3. Second active trip is blocked by the partial unique index, nothing changes
DO $$
DECLARE v_trip UUID; v_bal NUMERIC;
BEGIN
    BEGIN
        CALL sp_book_trip_atomic('00000000-0000-0000-0000-0000000000a1',
                                 '00000000-0000-0000-0000-0000000000b1', 10.00, v_trip);
        RAISE EXCEPTION 'second active trip was NOT blocked';
    EXCEPTION WHEN unique_violation THEN
        ASSERT SQLERRM LIKE '%idx_active_rider_trip%', 'wrong constraint: ' || SQLERRM;
    END;
    SELECT wallet_balance INTO v_bal FROM riders WHERE id = '00000000-0000-0000-0000-0000000000a1';
    ASSERT v_bal = 70.00, 'balance must be unchanged after a blocked booking';
    RAISE NOTICE 'PASS: second active trip rejected by idx_active_rider_trip (23505), balance untouched';
END $$;

-- 4. Status life-cycle: invalid jump rejected, valid path frees the slot
DO $$
DECLARE v_trip UUID; v_old VARCHAR;
BEGIN
    SELECT id INTO v_trip FROM trips WHERE rider_id = '00000000-0000-0000-0000-0000000000a1' AND status = 'REQUESTED';
    BEGIN
        CALL sp_update_trip_status(v_trip, 'COMPLETED', v_old);
        RAISE EXCEPTION 'REQUESTED -> COMPLETED should be rejected';
    EXCEPTION WHEN SQLSTATE 'RS005' THEN NULL;
    END;
    CALL sp_update_trip_status(v_trip, 'IN_TRANSIT', v_old);
    ASSERT v_old = 'REQUESTED';
    CALL sp_update_trip_status(v_trip, 'COMPLETED', v_old);
    ASSERT (SELECT completed_at IS NOT NULL FROM trips WHERE id = v_trip), 'completed_at not set';
    RAISE NOTICE 'PASS: REQUESTED -> IN_TRANSIT -> COMPLETED works, invalid jump raises RS005';
END $$;

-- 5. After completion a new booking is allowed; cancelling refunds the escrow
DO $$
DECLARE v_trip UUID; v_old VARCHAR; v_bal NUMERIC;
BEGIN
    CALL sp_book_trip_atomic('00000000-0000-0000-0000-0000000000a1',
                             '00000000-0000-0000-0000-0000000000b1', 20.00, v_trip);
    ASSERT (SELECT wallet_balance FROM riders WHERE id = '00000000-0000-0000-0000-0000000000a1') = 50.00;
    CALL sp_update_trip_status(v_trip, 'CANCELLED', v_old);
    SELECT wallet_balance INTO v_bal FROM riders WHERE id = '00000000-0000-0000-0000-0000000000a1';
    ASSERT v_bal = 70.00, format('refund expected 70.00, got %s', v_bal);
    ASSERT EXISTS (SELECT 1 FROM wallet_audit_logs WHERE reference_trip_id = v_trip
                   AND action_type = 'TRIP_REFUND' AND amount_changed = 20.00), 'refund not audited';
    RAISE NOTICE 'PASS: slot freed after completion; cancellation refunds and logs TRIP_REFUND';
END $$;

-- 6. Insufficient balance raises RS001 and leaves no trace
DO $$
DECLARE v_trip UUID; v_before BIGINT;
BEGIN
    SELECT count(*) INTO v_before FROM wallet_audit_logs WHERE rider_id = '00000000-0000-0000-0000-0000000000a1';
    BEGIN
        CALL sp_book_trip_atomic('00000000-0000-0000-0000-0000000000a1',
                                 '00000000-0000-0000-0000-0000000000b1', 500.00, v_trip);
        RAISE EXCEPTION 'insufficient balance was NOT detected';
    EXCEPTION WHEN SQLSTATE 'RS001' THEN NULL;
    END;
    ASSERT (SELECT count(*) FROM wallet_audit_logs WHERE rider_id = '00000000-0000-0000-0000-0000000000a1') = v_before,
           'failed booking must not write an audit row';
    RAISE NOTICE 'PASS: insufficient balance -> RS001, no audit row, no trip';
END $$;

-- 7. Input guards: zero/negative fare, inactive vehicle, bad top-up
DO $$
DECLARE v_trip UUID; v_new NUMERIC;
BEGIN
    BEGIN CALL sp_book_trip_atomic('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 0, v_trip);
          RAISE EXCEPTION 'zero fare accepted'; EXCEPTION WHEN SQLSTATE 'RS004' THEN NULL; END;
    BEGIN CALL sp_book_trip_atomic('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', -5, v_trip);
          RAISE EXCEPTION 'negative fare accepted'; EXCEPTION WHEN SQLSTATE 'RS004' THEN NULL; END;
    BEGIN CALL sp_book_trip_atomic('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 5, v_trip);
          RAISE EXCEPTION 'inactive vehicle accepted'; EXCEPTION WHEN SQLSTATE 'RS002' THEN NULL; END;
    BEGIN CALL sp_topup_wallet('00000000-0000-0000-0000-0000000000a1', -1, v_new);
          RAISE EXCEPTION 'negative top-up accepted'; EXCEPTION WHEN SQLSTATE 'RS006' THEN NULL; END;
    CALL sp_topup_wallet('00000000-0000-0000-0000-0000000000a1', 30.00, v_new);
    ASSERT v_new = 100.00, format('top-up expected 100.00, got %s', v_new);
    RAISE NOTICE 'PASS: RS004 / RS002 / RS006 guards fire; top-up credits and returns new balance';
END $$;

-- 8. Audit trail function: running balance matches stored balance_after
DO $$
DECLARE v_rows INT; v_bad INT; v_last NUMERIC;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE NOT is_consistent)
    INTO v_rows, v_bad
    FROM fn_rider_audit_trail('00000000-0000-0000-0000-0000000000a1');
    ASSERT v_rows = 4, format('expected 4 ledger rows (debit, debit, refund, topup), got %s', v_rows);
    ASSERT v_bad = 0, 'running balance disagrees with balance_after';
    SELECT running_balance INTO v_last FROM fn_rider_audit_trail('00000000-0000-0000-0000-0000000000a1')
    ORDER BY logged_at DESC LIMIT 1;
    ASSERT v_last = (SELECT wallet_balance FROM riders WHERE id = '00000000-0000-0000-0000-0000000000a1'),
           'last running balance must equal current wallet balance';
    RAISE NOTICE 'PASS: fn_rider_audit_trail running balance is consistent and ends at wallet_balance';
END $$;

-- 9. Analytics views agree with the Part A query semantics
DO $$
DECLARE v_mismatch INT;
BEGIN
    -- rank 1 on any date must hold that date's maximum moving average
    SELECT count(*) INTO v_mismatch
    FROM (
        SELECT trip_date,
               max(seven_day_moving_avg_revenue) AS best,
               max(seven_day_moving_avg_revenue) FILTER (WHERE daily_performance_rank = 1) AS rank1
        FROM vw_vehicle_revenue_ranking
        WHERE trip_date >= (SELECT max(trip_date) - 3 FROM vw_vehicle_revenue_ranking)
        GROUP BY trip_date
    ) d WHERE best IS DISTINCT FROM rank1;
    ASSERT v_mismatch = 0, 'DENSE_RANK 1 is not the top moving average';
    RAISE NOTICE 'PASS: vw_vehicle_revenue_ranking rank 1 = best 7-day moving average per day';
END $$;

ROLLBACK;
\echo 'All database tests passed (changes rolled back).'
