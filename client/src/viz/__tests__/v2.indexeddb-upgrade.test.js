import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_VERSION, STORE_VIZ_CACHE, STORE_VIZ_MAPPINGS } from '../../offline/constants.js';
import { upgradeOfflineDatabase } from '../../offline/dbSchema.js';

class FakeStore {
  constructor(name) { this.name = name; this.indexes = []; }
  createIndex(name, keyPath) { this.indexes.push({ name, keyPath }); return this; }
}

class FakeDb {
  constructor(existing = []) {
    this.names = new Set(existing);
    this.created = [];
    this.deleted = [];
    this.records = new Map(existing.map((name) => [name, [`sentinel:${name}`]]));
    this.objectStoreNames = { contains: (name) => this.names.has(name) };
  }
  createObjectStore(name, options) {
    assert.equal(this.names.has(name), false, `store ${name} must not be recreated`);
    this.names.add(name);
    this.created.push({ name, options, store: new FakeStore(name) });
    return this.created.at(-1).store;
  }
  deleteObjectStore(name) { this.deleted.push(name); this.names.delete(name); }
}

const V5_STORES = [
  'pendingExpeditions',
  'pendingContent',
  'expeditionCache',
  'globeCache',
  'savedExpeditions',
  'datasetMultipartUploads',
];

test('V2 performs one schema bump to version 6', () => {
  assert.equal(DB_VERSION, 6);
});

test('V2 upgrade from populated V5 only adds vizMappings and vizCache', () => {
  const db = new FakeDb(V5_STORES);
  const before = new Map([...db.records].map(([key, value]) => [key, [...value]]));
  upgradeOfflineDatabase(db);
  assert.deepEqual(db.created.map((item) => item.name).sort(), [STORE_VIZ_CACHE, STORE_VIZ_MAPPINGS].sort());
  assert.deepEqual(db.deleted, []);
  for (const name of V5_STORES) assert.deepEqual(db.records.get(name), before.get(name));
});

test('V2 fresh install creates legacy stores plus both visualization stores', () => {
  const db = new FakeDb();
  upgradeOfflineDatabase(db);
  for (const name of [...V5_STORES, STORE_VIZ_MAPPINGS, STORE_VIZ_CACHE]) assert.equal(db.names.has(name), true);
  assert.equal(db.deleted.length, 0);
});
