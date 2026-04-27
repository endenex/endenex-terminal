"""
Shared Supabase client and batch upsert logic for all ingestion pipelines.
"""
import os
import logging
from datetime import date
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger(__name__)

BATCH_SIZE = 500


def get_supabase_client() -> Client:
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise EnvironmentError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    return create_client(url, key)


def upsert_assets(client: Client, records: list[dict]) -> int:
    """
    Upsert asset records in batches. Conflict resolution on (external_id, source_type).
    Returns total number of records upserted.
    """
    if not records:
        log.warning('No records to upsert')
        return 0

    total = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        client.table('assets').upsert(
            batch,
            on_conflict='external_id,source_type'
        ).execute()
        total += len(batch)
        log.info(f'  Upserted batch {i // BATCH_SIZE + 1}: {len(batch)} records ({total} total)')

    return total


def today_iso() -> str:
    return date.today().isoformat()
