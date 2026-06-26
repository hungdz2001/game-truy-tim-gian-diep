const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createInitialState, createRoom } = require('../src/game-engine');
const { loadState, saveState } = require('../src/persistence');

test('saveState and loadState round-trip game state JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spy-state-'));
  const filePath = path.join(dir, 'game-state.json');
  const state = createRoom(createInitialState(), { roomCode: 'SPY-2026', now: 1000 });

  saveState(filePath, state);
  const restored = loadState(filePath, createInitialState);

  assert.equal(restored.roomCode, 'SPY-2026');
  assert.equal(restored.phase, 'lobby');
});

test('loadState returns a fresh state when the JSON file does not exist or is invalid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spy-state-'));
  const missingPath = path.join(dir, 'missing.json');
  const invalidPath = path.join(dir, 'invalid.json');
  fs.writeFileSync(invalidPath, '{bad-json', 'utf8');

  assert.deepEqual(loadState(missingPath, createInitialState), createInitialState());
  assert.deepEqual(loadState(invalidPath, createInitialState), createInitialState());
});
