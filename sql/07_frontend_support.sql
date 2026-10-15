-- ============================================================================
-- RideSync - Assignment 1B
-- 07_frontend_support.sql: database objects the web front end needs
-- ============================================================================
-- Principle: the API stays thin. Anything that is business logic (moving a
-- trip through its life-cycle, refunds, top-ups, running balances, analytics)
-- lives here so the database enforces it no matter who calls it.
--
-- Run AFTER 01-05 (and before or after seeding - nothing here depends on data).
--
-- Custom SQLSTATEs (shared with 04_stored_procedures.sql):
--   RS001 insufficient balance     RS002 vehicle inactive / missing
--   RS003 rider missing            RS004 invalid fare
--   RS005 invalid status change    RS006 invalid top-up amount
--   RS007 trip missing
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Wallet top-up (lets a demo user recover from "insufficient balance")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_topup_wallet(
    p_rider_id UUID,
    p_amount NUMERIC(10, 2),
    OUT p_new_balance NUMERIC(10, 2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 5000 THEN
        RAISE EXCEPTION 'Top-up amount must be between 0.01 and 5000.00 (got %).', p_amount
            USING ERRCODE = 'RS006';
    END IF;

    PERFORM 1 FROM riders WHERE id = p_rider_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rider % does not exist.', p_rider_id USING ERRCODE = 'RS003';
    END IF;

    PERFORM set_config('ridesync.audit_reason', 'TOPUP', true);
    PERFORM set_config('ridesync.audit_ref', '', true);

    UPDATE riders
    SET wallet_balance = wallet_balance + p_amount
    WHERE id = p_rider_id
    RETURNING wallet_balance INTO p_new_balance;

    PERFORM set_config('ridesync.audit_reason', '', true);
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. Trip life-cycle. Allowed transitions:
--        REQUESTED  -> IN_TRANSIT | CANCELLED
--        IN_TRANSIT -> COMPLETED  | CANCELLED
--    COMPLETED and CANCELLED are terminal. Leaving an active state frees the
--    rider's slot in idx_active_rider_trip, so a new booking becomes possible.
--    Cancelling refunds the escrowed fare (trigger logs TRIP_REFUND).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_update_trip_status(
    p_trip_id UUID,
    p_new_status VARCHAR(50),
    OUT p_old_status VARCHAR(50)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_trip trips%ROWTYPE;
BEGIN
    SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip % does not exist.', p_trip_id USING ERRCODE = 'RS007';
    END IF;

    p_old_status := v_trip.status;

    IF NOT (
        (v_trip.status = 'REQUESTED'  AND p_new_status IN ('IN_TRANSIT', 'CANCELLED')) OR
        (v_trip.status = 'IN_TRANSIT' AND p_new_status IN ('COMPLETED', 'CANCELLED'))
    ) THEN
        RAISE EXCEPTION 'A trip cannot move from % to %.', v_trip.status, p_new_status
            USING ERRCODE = 'RS005';
    END IF;

    IF p_new_status = 'CANCELLED' THEN
        PERFORM set_config('ridesync.audit_reason', 'TRIP_REFUND', true);
        PERFORM set_config('ridesync.audit_ref', p_trip_id::TEXT, true);

        UPDATE riders
        SET wallet_balance = wallet_balance + v_trip.fare_amount
        WHERE id = v_trip.rider_id;

        PERFORM set_config('ridesync.audit_reason', '', true);
        PERFORM set_config('ridesync.audit_ref', '', true);
    END IF;

    UPDATE trips
    SET status = p_new_status,
        completed_at = CASE WHEN p_new_status = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END
    WHERE id = p_trip_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. Audit trail with running balance (Audit screen)
--    running_balance is recomputed independently from the ledger:
--        balance_before of the first row in the window + cumulative SUM of
--        amount_changed
--    and compared with the balance_after the trigger stored. If the ledger
--    were ever edited or a movement skipped the trigger, is_consistent
--    would flip to FALSE on that row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_rider_audit_trail(
    p_rider_id UUID,
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    logged_at TIMESTAMPTZ,
    action_type VARCHAR(50),
    amount_changed NUMERIC(10, 2),
    balance_before NUMERIC(10, 2),
    balance_after NUMERIC(10, 2),
    reference_trip_id UUID,
    running_balance NUMERIC(12, 2),
    is_consistent BOOLEAN
)
LANGUAGE sql STABLE
AS $$
    WITH ledger AS (
        SELECT w.id, w.timestamp, w.action_type, w.amount_changed,
               w.balance_before, w.balance_after, w.reference_trip_id
        FROM wallet_audit_logs w
        WHERE w.rider_id = p_rider_id
          AND (p_from IS NULL OR w.timestamp >= p_from)
          AND (p_to   IS NULL OR w.timestamp <  p_to)
    ), running AS (
        SELECT l.*,
               FIRST_VALUE(l.balance_before) OVER w
                 + SUM(l.amount_changed) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                 AS running_balance
        FROM ledger l
        WINDOW w AS (ORDER BY l.timestamp, l.id)
    )
    SELECT r.id, r.timestamp, r.action_type, r.amount_changed, r.balance_before,
           r.balance_after, r.reference_trip_id, r.running_balance,
           (r.running_balance = r.balance_after) AS is_consistent
    FROM running r
$$;


-- ---------------------------------------------------------------------------
-- 4. Workflow 2 as views. This is the Part A query from
--    06_window_analytics.sql split at its CTE boundary so the API can filter
--    it without copying SQL into JavaScript:
--      vw_vehicle_moving_avg      - steps 1+2 (daily revenue + 7-day MA).
--                                   A WHERE vehicle_id = ... filter is pushed
--                                   below the window (vehicle_id is the
--                                   PARTITION BY key), so one vehicle's chart
--                                   uses idx_trips_vehicle_id_status.
--      vw_vehicle_revenue_ranking - step 3 (DENSE_RANK per day), identical
--                                   output to running 06_window_analytics.sql.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_vehicle_revenue_ranking;
DROP VIEW IF EXISTS vw_vehicle_moving_avg;

CREATE VIEW vw_vehicle_moving_avg AS
WITH daily_vehicle_revenue AS (
    SELECT
        v.id AS vehicle_id,
        v.license_plate,
        v.class,
        DATE_TRUNC('day', t.created_at)::DATE AS trip_date,
        COUNT(t.id) AS daily_trips,
        SUM(t.fare_amount) AS daily_fare_revenue
    FROM vehicles v
    JOIN trips t ON v.id = t.vehicle_id
    WHERE t.status = 'COMPLETED'
    GROUP BY v.id, v.license_plate, v.class, DATE_TRUNC('day', t.created_at)::DATE
)
SELECT
    vehicle_id,
    license_plate,
    class,
    trip_date,
    daily_trips,
    daily_fare_revenue,
    ROUND(
        AVG(daily_fare_revenue) OVER (
            PARTITION BY vehicle_id
            ORDER BY trip_date
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ),
        2
    ) AS seven_day_moving_avg_revenue
FROM daily_vehicle_revenue;

CREATE VIEW vw_vehicle_revenue_ranking AS
SELECT
    trip_date,
    vehicle_id,
    license_plate,
    class,
    daily_trips,
    daily_fare_revenue,
    seven_day_moving_avg_revenue,
    DENSE_RANK() OVER (
        PARTITION BY trip_date
        ORDER BY seven_day_moving_avg_revenue DESC
    ) AS daily_performance_rank
FROM vw_vehicle_moving_avg;
