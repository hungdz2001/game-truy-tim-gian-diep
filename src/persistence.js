const fs = require('node:fs');
const path = require('node:path');

function saveState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function loadState(filePath, createDefaultState) {
  try {
    if (!fs.existsSync(filePath)) {
      return createDefaultState();
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return createDefaultState();
  }
}

module.exports = {
  saveState,
  loadState,
};
