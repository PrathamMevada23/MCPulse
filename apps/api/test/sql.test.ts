import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../src/db/sql.js';

describe('splitSqlStatements', () => {
  it('splits plain statements', () => {
    const result = splitSqlStatements(
      'CREATE TABLE a (id int); CREATE TABLE b (id int);',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('CREATE TABLE a');
    expect(result[1]).toContain('CREATE TABLE b');
  });

  it('ignores semicolons inside string literals', () => {
    const result = splitSqlStatements(
      "INSERT INTO t (name) VALUES ('a; b'); SELECT 1;",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("'a; b'");
  });

  it('ignores semicolons inside quoted identifiers', () => {
    const result = splitSqlStatements('SELECT "weird;name" FROM t; SELECT 2;');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('"weird;name"');
  });

  it('ignores semicolons inside dollar quoted blocks', () => {
    const result = splitSqlStatements(
      'CREATE FUNCTION f() RETURNS void AS $$ BEGIN; END; $$ LANGUAGE plpgsql; SELECT 1;',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('$$ BEGIN; END; $$');
  });

  it('removes comments', () => {
    const result = splitSqlStatements(
      '-- a comment; with a semicolon\nCREATE TABLE a (id int); /* block; comment */ SELECT 1;',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).not.toContain('comment');
    expect(result[1]).toBe('SELECT 1');
  });

  it('returns nothing for an empty file', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('   \n-- only a comment\n')).toEqual([]);
  });
});
