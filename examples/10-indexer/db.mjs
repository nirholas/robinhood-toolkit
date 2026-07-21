/**
 * robinhood-toolkit · example 10: indexer storage with idempotent writes
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * SQLite with WAL. The whole design turns on one thing: the composite primary
 * key on (tx_hash, log_index). That is what makes re-running a block range
 * safe. An indexer that duplicates rows when a range is reprocessed is an
 * indexer you can never restart with confidence, and on a chain producing a
 * block every ~101 ms you WILL restart it.
 */
import Database from 'better-sqlite3'

export function openDb(path = new URL('./events.db', import.meta.url).pathname) {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      block_number INTEGER NOT NULL,
      block_hash   TEXT    NOT NULL,
      tx_hash      TEXT    NOT NULL,
      log_index    INTEGER NOT NULL,
      token        TEXT    NOT NULL,
      from_addr    TEXT    NOT NULL,
      to_addr      TEXT    NOT NULL,
      value_raw    TEXT    NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_block ON transfers(block_number);
    CREATE INDEX IF NOT EXISTS idx_transfers_from  ON transfers(from_addr);
    CREATE INDEX IF NOT EXISTS idx_transfers_to    ON transfers(to_addr);

    CREATE TABLE IF NOT EXISTS cursor (
      stream          TEXT PRIMARY KEY,
      last_block      INTEGER NOT NULL,
      last_block_hash TEXT,
      updated_at      TEXT NOT NULL
    );
  `)
  return db
}

export function makeStatements(db) {
  return {
    insertTransfer: db.prepare(`
      INSERT INTO transfers (block_number, block_hash, tx_hash, log_index, token, from_addr, to_addr, value_raw)
      VALUES (@block_number, @block_hash, @tx_hash, @log_index, @token, @from_addr, @to_addr, @value_raw)
      ON CONFLICT(tx_hash, log_index) DO UPDATE SET
        block_number = excluded.block_number,
        block_hash   = excluded.block_hash
    `),
    readCursor: db.prepare('SELECT last_block, last_block_hash FROM cursor WHERE stream = ?'),
    writeCursor: db.prepare(`
      INSERT INTO cursor (stream, last_block, last_block_hash, updated_at)
      VALUES (@stream, @last_block, @last_block_hash, @updated_at)
      ON CONFLICT(stream) DO UPDATE SET
        last_block      = excluded.last_block,
        last_block_hash = excluded.last_block_hash,
        updated_at      = excluded.updated_at
    `),
    deleteFromBlock: db.prepare('DELETE FROM transfers WHERE block_number >= ?'),
    countTransfers: db.prepare('SELECT COUNT(*) AS n FROM transfers'),
    countDuplicates: db.prepare(
      "SELECT COUNT(*) - COUNT(DISTINCT tx_hash || ':' || log_index) AS dups FROM transfers",
    ),
  }
}
