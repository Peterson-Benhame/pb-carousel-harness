import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import archiver from 'archiver';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

function openQualifiedDatabase(filename) {
  const db = new Database(filename);
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  assert.equal(db.pragma('journal_mode', { simple: true }).toLowerCase(), 'delete');
  assert.equal(db.pragma('synchronous', { simple: true }), 2);
  assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  return db;
}

test('ESM imports, native SQLite, transactions, backup, and reopen', async () => {
  assert.equal(typeof Database, 'function');
  assert.equal(typeof sharp, 'function');
  assert.equal(typeof fontkit.openSync, 'function');
  assert.equal(typeof archiver, 'function');
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v24.21.0');

  const dir = await mkdtemp(path.join(projectRoot, '.qualification-'));
  const primaryPath = path.join(dir, 'primary.sqlite');
  const backupPath = path.join(dir, 'backup.sqlite');
  let primary;
  let reopened;
  let backup;
  try {
    primary = openQualifiedDatabase(primaryPath);
    primary.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parent(id)
      );
    `);

    const insert = primary.transaction(() => {
      primary.prepare('INSERT INTO parent (id, label) VALUES (?, ?)').run(1, 'synthetic-commit');
      primary.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(1, 1);
    });
    insert();
    assert.equal(primary.prepare('SELECT COUNT(*) AS count FROM child').get().count, 1);

    const fail = primary.transaction(() => {
      primary.prepare('INSERT INTO parent (id, label) VALUES (?, ?)').run(2, 'synthetic-rollback');
      throw new Error('intentional rollback');
    });
    assert.throws(fail, /intentional rollback/);
    assert.equal(primary.prepare('SELECT COUNT(*) AS count FROM parent').get().count, 1);
    assert.throws(() => primary.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(2, 999));

    await primary.backup(backupPath);
    primary.prepare('INSERT INTO parent (id, label) VALUES (?, ?)').run(3, 'after-backup');
    primary.close();
    primary = undefined;

    reopened = openQualifiedDatabase(primaryPath);
    backup = openQualifiedDatabase(backupPath);
    assert.deepEqual(reopened.prepare('SELECT id FROM parent ORDER BY id').all().map(row => row.id), [1, 3]);
    assert.deepEqual(backup.prepare('SELECT id FROM parent ORDER BY id').all().map(row => row.id), [1]);
    assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok');
    assert.throws(() => reopened.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(4, 999));
    assert.throws(() => backup.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(4, 999));
    assert.ok((await readFile(primaryPath)).length > 0);
    assert.ok((await readFile(backupPath)).length > 0);
  } finally {
    primary?.close();
    reopened?.close();
    backup?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('sharp renders a valid synthetic PNG with exact dimensions and pixels', async () => {
  const pixels = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.channels, 4);
  assert.deepEqual(decoded.data, pixels);
});
