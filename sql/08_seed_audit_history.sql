-- ============================================================================
-- RideSync - Assignment 1B
-- 08_seed_audit_history.sql: back-fill a realistic wallet ledger
-- ============================================================================
-- Why: postgres_seeder.py inserts riders with their final wallet_balance and
-- inserts trips directly, so trg_audit_wallet_balance never fires during
-- seeding and wallet_audit_logs starts EMPTY. The Audit Trail screen would
-- have nothing to show for any of the 10,000 seeded riders.
--
-- What: for every rider we rebuild a ledger that is consistent with the data
-- already present, working BACKWARDS from today's wallet_balance:
--   * one TRIP_ESCROW_DEBIT per non-cancelled trip, at the trip's created_at
--     (assumption: CANCELLED seed trips were cancelled before escrow, so they
--     have no wallet movement);
--   * TOPUP rows inserted whenever the reconstructed balance would exceed a
--     random cap, plus one opening TOPUP that starts the wallet from 0.
-- Walking backwards guarantees every balance_before/balance_after is >= 0 and
-- that the newest row's balance_after equals riders.wallet_balance exactly.
--
-- These are historical rows, so they are INSERTed directly (the trigger only
-- records live changes). All rows created through the UI afterwards come from
-- the trigger. Safe to re-run: does nothing if the ledger already has rows.
--
-- Run AFTER data_generation/postgres_seeder.py.  ~100k rows, a few seconds.
-- ============================================================================

DO $$
DECLARE
    r         RECORD;
    e         RECORD;
    v_bal     NUMERIC(12, 2);
    v_cap     NUMERIC(12, 2);
    v_amt     NUMERIC(12, 2);
    v_ts      TIMESTAMPTZ;
    v_first   TIMESTAMPTZ;
    v_rows    BIGINT := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM wallet_audit_logs) THEN
        RAISE NOTICE 'wallet_audit_logs already has rows - skipping back-fill.';
        RETURN;
    END IF;

    PERFORM setseed(0.2026);

    CREATE TEMP TABLE _ledger (
        rider_id UUID, amount_changed NUMERIC(10, 2), action_type VARCHAR(50),
        balance_before NUMERIC(10, 2), balance_after NUMERIC(10, 2),
        ts TIMESTAMPTZ, reference_trip_id UUID
    ) ON COMMIT DROP;

    FOR r IN SELECT id, wallet_balance, created_at FROM riders LOOP
        v_bal := r.wallet_balance;
        v_cap := 250 + floor(random() * 250);
        v_first := NULL;

        FOR e IN
            SELECT t.id, t.fare_amount, t.created_at,
                   LAG(t.created_at) OVER (ORDER BY t.created_at) AS prev_at
            FROM trips t
            WHERE t.rider_id = r.id AND t.status <> 'CANCELLED'
            ORDER BY t.created_at DESC
        LOOP
            -- debit that took the wallet from (v_bal + fare) down to v_bal
            INSERT INTO _ledger VALUES (r.id, -e.fare_amount, 'TRIP_ESCROW_DEBIT',
                                        v_bal + e.fare_amount, v_bal, e.created_at, e.id);
            v_bal := v_bal + e.fare_amount;
            v_first := e.created_at;

            -- a top-up somewhere between the previous trip and this one
            IF v_bal > v_cap AND e.prev_at IS NOT NULL THEN
                v_amt := ROUND(v_bal - (20 + random() * 60)::NUMERIC, 0);
                IF v_amt > 0 THEN
                    v_ts := e.created_at - LEAST((e.created_at - e.prev_at) / 2, INTERVAL '6 hours');
                    INSERT INTO _ledger VALUES (r.id, v_amt, 'TOPUP', v_bal - v_amt, v_bal, v_ts, NULL);
                    v_bal := v_bal - v_amt;
                END IF;
            END IF;
        END LOOP;

        -- opening top-up from an empty wallet
        IF v_bal > 0 THEN
            v_ts := COALESCE(v_first - INTERVAL '1 day', LEAST(r.created_at, now() - INTERVAL '1 day'));
            INSERT INTO _ledger VALUES (r.id, v_bal, 'TOPUP', 0, v_bal, v_ts, NULL);
        END IF;
    END LOOP;

    INSERT INTO wallet_audit_logs (rider_id, amount_changed, action_type, balance_before,
                                   balance_after, timestamp, reference_trip_id)
    SELECT rider_id, amount_changed, action_type, balance_before, balance_after, ts, reference_trip_id
    FROM _ledger;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    RAISE NOTICE 'Back-filled % wallet_audit_logs rows.', v_rows;
END $$;

ANALYZE wallet_audit_logs;
