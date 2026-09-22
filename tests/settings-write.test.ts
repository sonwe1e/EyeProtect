import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SettingsStore } from '../src/main/settings';

const withTempStore = (fn: (store: SettingsStore, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-w-'));
  const original = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = dir;
  try {
    fn(new SettingsStore(), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) {
      delete process.env.EYEPROTECT_DATA_DIR;
    } else {
      process.env.EYEPROTECT_DATA_DIR = original;
    }
  }
};

test('save writes settings.json atomically and leaves no .tmp residue', () => {
  withTempStore((store, dir) => {
    store.save({ eyeIntervalMinutes: 25 });
    const files = readdirSync(dir);
    assert.ok(files.includes('settings.json'), 'settings.json must exist');
    assert.ok(!files.some((name) => name.endsWith('.tmp')), 'no .tmp residue after a successful save');
  });
});

test('a second save replaces the previous file without stale tmp files', () => {
  withTempStore((store, dir) => {
    store.save({ eyeIntervalMinutes: 25 });
    store.save({ eyeIntervalMinutes: 30 });
    const files = readdirSync(dir).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(files, [], 'repeated saves must not accumulate temp files');
  });
});

test('save persists the sanitized value through a fresh store instance', () => {
  withTempStore((store, dir) => {
    store.save({ eyeIntervalMinutes: 25 });
    const reloaded = new SettingsStore();
    assert.equal(reloaded.get().eyeIntervalMinutes, 25);
  });
});

test('save is resilient when the data directory is removed mid-flight', () => {
  withTempStore((store, dir) => {
    rmSync(dir, { recursive: true, force: true });
    // Must not throw: persistence is best-effort and the in-memory state wins.
    assert.doesNotThrow(() => store.save({ eyeIntervalMinutes: 25 }));
    assert.equal(store.get().eyeIntervalMinutes, 25);
  });
});

test('save keeps working after the directory is recreated', () => {
  withTempStore((store, dir) => {
    rmSync(dir, { recursive: true, force: true });
    assert.doesNotThrow(() => store.save({ eyeIntervalMinutes: 25 }));
    assert.equal(existsSync(join(dir, 'settings.json')), true, 'directory is recreated on demand');
  });
});

test('corrupt settings.json is quarantined and the next save writes a clean file', () => {
  withTempStore((store, dir) => {
    writeFileSync(join(dir, 'settings.json'), '{not json', 'utf8');
    const reloaded = new SettingsStore();
    assert.equal(reloaded.get().eyeIntervalMinutes, 20, 'defaults after quarantine');
    const files = readdirSync(dir);
    assert.ok(files.some((name) => name.includes('.corrupt-')), 'corrupt file preserved as evidence');
    // The fresh file is written lazily on the next save, not at read time.
    reloaded.save({ eyeIntervalMinutes: 22 });
    const after = readdirSync(dir);
    assert.ok(after.includes('settings.json'), 'a fresh clean file is written on save');
  });
});


test('pet selection persists with order and returns an isolated snapshot', () => {
  withTempStore((store) => {
    assert.equal(store.get().petAppearance, 'cat');
    store.save({ todoBubbleTaskIds: ['b', 'a', 'b'], petAppearance: 'cat' });
    const snapshot = store.get();
    snapshot.todoBubbleTaskIds.push('unwanted');
    const restored = new SettingsStore().get();
    assert.deepEqual(restored.todoBubbleTaskIds, ['b', 'a']);
    assert.deepEqual(store.get().todoBubbleTaskIds, ['b', 'a']);
    assert.equal(restored.petAppearance, 'cat');
  });
});

test('legacy settings invalid appearance selection is cleaned', () => {
  withTempStore((_store, dir) => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ todoBubbleTaskIds: ['a', '', 2, null, 'a'] }));
    const restored = new SettingsStore().get();
    assert.equal(restored.petAppearance, 'cat');
    assert.deepEqual(restored.todoBubbleTaskIds, ['a']);
  });
});

test('a removed collectible-character id falls back to a built-in animal', () => {
  withTempStore((_store, dir) => {
    // The old "组合桌宠" collection stored generated character ids here; the
    // pixel-animal setting must reject them instead of rendering nothing.
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ petAppearance: 'character-1a2b3c' }));
    assert.equal(new SettingsStore().get().petAppearance, 'cat');
  });
});

test('sound and fullscreen DND settings are persisted and sanitized within bounds', () => {
  withTempStore((store) => {
    assert.equal(store.get().soundEnabled, true);
    assert.equal(store.get().soundVolume, 0.6);
    assert.equal(store.get().fullscreenDndEnabled, false);

    store.save({
      soundEnabled: false,
      soundVolume: 1.5, // should clamp to 1
      fullscreenDndEnabled: true
    });

    const reloaded = new SettingsStore().get();
    assert.equal(reloaded.soundEnabled, false);
    assert.equal(reloaded.soundVolume, 1);
    assert.equal(reloaded.fullscreenDndEnabled, true);

    store.save({
      soundVolume: -0.2 // should clamp to 0
    });
    assert.equal(new SettingsStore().get().soundVolume, 0);
  });
});

test('legacy multi-pet ids fall back to 奋斗猫', () => {
  withTempStore((_store, dir) => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ petAppearance: 'rabbit', customPetTheme: 'shiba' }));
    const restored = new SettingsStore().get();
    assert.equal(restored.petAppearance, 'cat');
  });
});

