import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SettingsStore, syncStartupShortcut, sanitizeSettings } from '../src/main/settings';
import { PET_OUTFITS } from '../src/shared/pixelAnimals';
import { DEFAULT_SETTINGS } from '../src/shared/types';

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

test('outfits keep the original cat for legacy or invalid preferences', () => {
  for (const petOutfit of [undefined, null, '', 'rabbit', 'character-123', 0, {}, ['coffee']]) {
    assert.equal(sanitizeSettings({ petOutfit }).petOutfit, 'classic');
  }
});

test('every built-in outfit survives save and restart without changing the companion', () => {
  withTempStore((store) => {
    for (const petOutfit of PET_OUTFITS) {
      store.save({ petOutfit });
      const restored = new SettingsStore().get();
      assert.equal(restored.petOutfit, petOutfit);
      assert.equal(restored.petAppearance, 'cat');
    }
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

test('startup creates its directory, targets the launcher and only removes its own shortcut', () => {
  withTempStore((_store, dir) => {
    const startupDir = join(dir, 'Startup');
    const launcher = join(dir, 'EyeProtect-portable.exe');
    const runtime = {
      isPackaged: true, launchExecutable: launcher, startupDir,
      writeShortcut: (path: string, target: string) => {
        assert.equal(target, launcher);
        assert.ok(existsSync(startupDir));
        writeFileSync(path, target);
        return true;
      }
    };
    syncStartupShortcut({ ...DEFAULT_SETTINGS, startWithWindows: true }, runtime);
    writeFileSync(join(startupDir, 'other.lnk'), 'other');
    syncStartupShortcut({ ...DEFAULT_SETTINGS, startWithWindows: false }, runtime);
    assert.equal(existsSync(join(startupDir, 'EyeProtect.lnk')), false);
    assert.equal(existsSync(join(startupDir, 'other.lnk')), true);
  });
});

test('shortcut failure rejects saving before preferences or events claim success', () => {
  withTempStore((_store, dir) => {
    const store = new SettingsStore((settings) => syncStartupShortcut(settings, {
      isPackaged: true, launchExecutable: join(dir, 'EyeProtect.exe'), startupDir: join(dir, 'Startup'),
      writeShortcut: () => false
    }));
    let changes = 0;
    store.onChanged(() => { changes += 1; });
    assert.throws(() => store.save({ startWithWindows: true }), /开机启动/);
    assert.equal(store.get().startWithWindows, false);
    assert.equal(new SettingsStore().get().startWithWindows, false);
    assert.equal(changes, 0);
  });
});

test('failed settings persistence restores the previous startup choice', () => {
  withTempStore((_store, dir) => {
    const choices: boolean[] = [];
    const store = new SettingsStore((settings) => choices.push(settings.startWithWindows));
    mkdirSync(join(dir, 'settings.json.tmp'));
    assert.throws(() => store.save({ startWithWindows: true }));
    assert.deepEqual(choices, [true, false]);
    assert.equal(store.get().startWithWindows, false);
  });
});

test('development startup synchronization leaves Windows untouched', () => {
  syncStartupShortcut({ ...DEFAULT_SETTINGS, startWithWindows: true }, {
    isPackaged: false, launchExecutable: 'unused', startupDir: 'unused',
    writeShortcut: () => { assert.fail('development must not register startup'); }
  });
});
