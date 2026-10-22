import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './pool.js';
import { splitSqlStatements } from './sql.js';

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

const pool = getPool();

// Never wait forever for a lock held by another session.
await pool.query('SET lock_timeout = 15000');
await pool.query('SET statement_timeout = 60000');

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const files = (await readdir(migrationsDirectory))
  // Hidden files are skipped on purpose: macOS creates AppleDouble sidecar
  // files ("._001_initial.sql") that contain binary resource fork metadata.
  // Executing one of them as SQL makes the server reject the message.
  .filter((file) => file.endsWith('.sql') && !file.startsWith('.'))
  .sort();

for (const filename of files) {
  const applied = await pool.query(
    'SELECT 1 FROM schema_migrations WHERE filename = $1',
    [filename],
  );
  if (applied.rowCount) continue;

  const sql = await readFile(join(migrationsDirectory, filename), 'utf8');
  const statements = splitSqlStatements(sql);
  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    for (const [position, statement] of statements.entries()) {
      try {
        await client.query(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          JSON.stringify({
            event: 'migration_statement_failed',
            filename,
            statement: position + 1,
            of: statements.length,
            sql: statement.slice(0, 300),
            error: message,
          }),
        );
        throw error;
      }
    }
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
      filename,
    ]);
    await client.query('COMMIT');
    console.info(
      JSON.stringify({
        event: 'migration_applied',
        filename,
        statements: statements.length,
      }),
    );
  } catch (error) {
    // Roll back on a usable connection, otherwise destroy it so the pool
    // never hands a broken connection to the next caller.
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch {
      client.release(true);
    }
    released = true;
    throw error;
  } finally {
    if (!released) client.release();
  }
}

await pool.end();
