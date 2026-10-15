"""
RideSync - copy vehicle plates from PostgreSQL into MongoDB VehicleMetadata.

Run after sql/09_localize_india.sql (which changes vehicles.license_plate),
so the catalog documents show the same plate as the rest of the app:

    python data_generation/sync_vehicle_plates.py

Uses the same .env settings as the seeders. Safe to re-run.
"""

import os

import psycopg2
from dotenv import load_dotenv
from pymongo import MongoClient, UpdateOne

load_dotenv()


def main():
    pg = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=os.getenv("POSTGRES_PORT", "5432"),
        dbname=os.getenv("POSTGRES_DB", "ridesync_db"),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "postgres"),
    )
    with pg, pg.cursor() as cur:
        cur.execute("SELECT id::text, license_plate FROM vehicles")
        plates = cur.fetchall()
    pg.close()

    client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017/"))
    col = client[os.getenv("MONGO_DB", "ridesync_db")]["VehicleMetadata"]
    ops = [UpdateOne({"vehicle_id": vid}, {"$set": {"license_plate": plate}}) for vid, plate in plates]
    result = col.bulk_write(ops, ordered=False) if ops else None
    matched = result.matched_count if result else 0
    print(f"Updated plates in VehicleMetadata: {matched} of {len(plates)} vehicles matched.")
    client.close()


if __name__ == "__main__":
    main()
