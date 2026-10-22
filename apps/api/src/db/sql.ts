/**
 * Splits a SQL file into individual statements.
 *
 * The migration runner executes the statements one by one instead of sending
 * the whole file as a single multi statement query. Amazon RDS rejects a multi
 * statement query that fails halfway through, because the server aborts the
 * implicit transaction and the follow up ROLLBACK can then no longer be parsed
 * by the client. Executing statement by statement keeps the failure local,
 * reports the exact statement and leaves the connection usable.
 *
 * String literals, quoted identifiers, dollar quoted blocks and comments are
 * respected while splitting.
 */
export const splitSqlStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  const push = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) statements.push(trimmed);
    current = '';
  };

  while (index < sql.length) {
    const char = sql[index];

    // Line comment
    if (char === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      continue;
    }

    // Block comment
    if (char === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    // Single quoted literal
    if (char === "'") {
      let cursor = index + 1;
      current += char;
      while (cursor < sql.length) {
        current += sql[cursor];
        if (sql[cursor] === "'") {
          if (sql[cursor + 1] === "'") {
            current += sql[cursor + 1];
            cursor += 2;
            continue;
          }
          break;
        }
        cursor += 1;
      }
      index = cursor + 1;
      continue;
    }

    // Double quoted identifier
    if (char === '"') {
      let cursor = index + 1;
      current += char;
      while (cursor < sql.length) {
        current += sql[cursor];
        if (sql[cursor] === '"') break;
        cursor += 1;
      }
      index = cursor + 1;
      continue;
    }

    // Dollar quoted block
    if (char === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
      if (match) {
        const tag = match[0];
        const end = sql.indexOf(tag, index + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        current += sql.slice(index, stop);
        index = stop;
        continue;
      }
    }

    if (char === ';') {
      push();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  push();
  return statements;
};
