-- ============================================================================
-- RideSync - Global Ride-Hailing Network
-- 03_triggers_and_audit.sql: Audit Log Triggers on Rider Wallet Balance
-- ============================================================================
--
-- [A1B changes - see docs/handover_note.md]
--  1. The original function set NEW.updated_at inside an AFTER trigger. Changes
--     to NEW are ignored in AFTER triggers, so riders.updated_at never moved.
--     updated_at is now maintained by a separate BEFORE UPDATE trigger.
--  2. The action type was always the generic 'TOPUP_OR_REFUND' /
--     'DEBIT_OR_ESCROW'. Callers (the stored procedures) may now describe the
--     reason with a transaction-local setting:
--         set_config('ridesync.audit_reason', 'TRIP_ESCROW_DEBIT', true)
--         set_config('ridesync.audit_ref',    '<trip uuid>',       true)
--     The trigger falls back to the original generic labels when no reason is
--     set (e.g. a manual UPDATE in psql), so the original behaviour is kept.
--  3. The timestamp uses clock_timestamp() instead of CURRENT_TIMESTAMP so that
--     two wallet movements inside one transaction keep their real order
--     (CURRENT_TIMESTAMP is frozen at transaction start). This matters for
--     the running-balance view.

CREATE OR REPLACE FUNCTION fn_audit_wallet_balance_change()
RETURNS TRIGGER AS $$
DECLARE
    v_diff   NUMERIC(10, 2);
    v_action VARCHAR(50);
    v_ref    TEXT;
BEGIN
    IF OLD.wallet_balance IS DISTINCT FROM NEW.wallet_balance THEN
        v_diff := NEW.wallet_balance - OLD.wallet_balance;

        v_action := NULLIF(current_setting('ridesync.audit_reason', true), '');
        IF v_action IS NULL THEN
            IF v_diff > 0 THEN
                v_action := 'TOPUP_OR_REFUND';
            ELSE
                v_action := 'DEBIT_OR_ESCROW';
            END IF;
        END IF;

        v_ref := NULLIF(current_setting('ridesync.audit_ref', true), '');

        INSERT INTO wallet_audit_logs (
            id,
            rider_id,
            amount_changed,
            action_type,
            balance_before,
            balance_after,
            timestamp,
            reference_trip_id
        ) VALUES (
            gen_random_uuid(),
            NEW.id,
            v_diff,
            v_action,
            OLD.wallet_balance,
            NEW.wallet_balance,
            clock_timestamp(),
            v_ref::UUID
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger firing AFTER UPDATE of wallet_balance on riders table
DROP TRIGGER IF EXISTS trg_audit_wallet_balance ON riders;
CREATE TRIGGER trg_audit_wallet_balance
AFTER UPDATE OF wallet_balance ON riders
FOR EACH ROW
EXECUTE FUNCTION fn_audit_wallet_balance_change();

-- [A1B] BEFORE trigger that actually maintains riders.updated_at
CREATE OR REPLACE FUNCTION fn_touch_rider_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.wallet_balance IS DISTINCT FROM NEW.wallet_balance THEN
        NEW.updated_at := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_rider_updated_at ON riders;
CREATE TRIGGER trg_touch_rider_updated_at
BEFORE UPDATE OF wallet_balance ON riders
FOR EACH ROW
EXECUTE FUNCTION fn_touch_rider_updated_at();
