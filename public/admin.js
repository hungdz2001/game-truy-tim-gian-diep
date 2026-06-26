const socket = io();
const ui = window.SpyGameUI;

let adminAuthed = false;
let adminState = null;
let timerState = null;

const el = {
  authPanel: document.getElementById('auth-panel'),
  adminApp: document.getElementById('admin-app'),
  authForm: document.getElementById('auth-form'),
  adminPin: document.getElementById('admin-pin'),
  authMessage: document.getElementById('auth-message'),
  roomPill: document.getElementById('admin-room-pill'),
  phasePill: document.getElementById('admin-phase-pill'),
  timerPill: document.getElementById('admin-timer-pill'),
  phaseLine: document.getElementById('admin-phase-line'),
  roomForm: document.getElementById('room-form'),
  roomCodeInput: document.getElementById('room-code-input'),
  roomCodeDisplay: document.getElementById('room-code-display'),
  roomMessage: document.getElementById('room-message'),
  resetButton: document.getElementById('reset-button'),
  endGameButton: document.getElementById('end-game-button'),
  actionCard: document.getElementById('admin-action-card'),
  actionTitle: document.getElementById('admin-action-title'),
  actionHint: document.getElementById('admin-action-hint'),
  playerCount: document.getElementById('admin-player-count'),
  spyPool: document.getElementById('admin-spy-pool'),
  progressChip: document.getElementById('admin-progress-chip'),
  roundForm: document.getElementById('round-form'),
  spyCount: document.getElementById('spy-count'),
  civilianKeyword: document.getElementById('civilian-keyword'),
  spyKeyword: document.getElementById('spy-keyword'),
  startRoundButton: document.getElementById('start-round-button'),
  forceDescriptionButton: document.getElementById('force-description-button'),
  openVoteButton: document.getElementById('open-vote-button'),
  forceVoteButton: document.getElementById('force-vote-button'),
  nextRoundButton: document.getElementById('next-round-button'),
  roundMessage: document.getElementById('round-message'),
  roundData: document.getElementById('admin-round-data'),
  playerList: document.getElementById('admin-player-list'),
  leaderboard: document.getElementById('admin-leaderboard'),
};

const phaseButtons = [
  el.forceDescriptionButton,
  el.openVoteButton,
  el.forceVoteButton,
  el.nextRoundButton,
];

el.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await emitAck('admin:auth', { pin: el.adminPin.value.trim() });
  if (!result.ok) {
    setMessage(el.authMessage, result.message);
    return;
  }
  adminAuthed = true;
  adminState = result.state;
  el.authPanel.hidden = true;
  el.adminApp.hidden = false;
  render();
});

el.roomForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await emitAck('admin:create_room', { roomCode: el.roomCodeInput.value.trim() });
  setMessage(el.roomMessage, result.ok ? `Đã tạo phòng ${result.roomCode}.` : result.message, result.ok ? 'done' : '');
});

el.roundForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await emitAck('admin:start_round', {
    spyCount: Number(el.spyCount.value),
    civilianKeyword: el.civilianKeyword.value.trim(),
    spyKeyword: el.spyKeyword.value.trim(),
  });
  setMessage(el.roundMessage, result.ok ? `Đã bắt đầu vòng ${result.roundNumber}.` : result.message, result.ok ? 'done' : '');
});

el.forceDescriptionButton.addEventListener('click', async () => {
  const result = await emitAck('admin:force_description_end', {});
  setMessage(el.roundMessage, result.ok ? 'Đã khóa mô tả.' : result.message, result.ok ? 'done' : '');
});

el.openVoteButton.addEventListener('click', async () => {
  const result = await emitAck('admin:open_vote', {});
  setMessage(el.roundMessage, result.ok ? 'Đã mở vote.' : result.message, result.ok ? 'done' : '');
});

el.forceVoteButton.addEventListener('click', async () => {
  const result = await emitAck('admin:force_vote_end', {});
  setMessage(el.roundMessage, result.ok ? 'Đã khóa vote.' : result.message, result.ok ? 'done' : '');
});

el.nextRoundButton.addEventListener('click', async () => {
  const result = await emitAck('admin:next_round', {});
  setMessage(el.roundMessage, result.ok ? 'Đã chuyển sang vòng mới.' : result.message, result.ok ? 'done' : '');
});

el.endGameButton.addEventListener('click', async () => {
  const result = await emitAck('admin:end_game', {});
  setMessage(el.roomMessage, result.ok ? 'Đã tổng kết game.' : result.message, result.ok ? 'done' : '');
});

el.resetButton.addEventListener('click', async () => {
  if (!confirm('Reset toàn bộ game hiện tại?')) return;
  const result = await emitAck('admin:reset_game', {});
  setMessage(el.roomMessage, result.ok ? 'Đã reset game.' : result.message, result.ok ? 'done' : '');
});

socket.on('admin:state', (payload) => {
  adminState = payload;
  render();
});

socket.on('timer:tick', (payload) => {
  timerState = payload;
  renderTimer();
});

socket.on('error:message', (payload) => {
  setMessage(el.authMessage, payload.message || '');
  setMessage(el.roomMessage, payload.message || '');
  setMessage(el.roundMessage, payload.message || '');
});

function render() {
  if (!adminAuthed || !adminState) return;

  const phase = adminState.phase || 'setup';
  const hasRoom = Boolean(adminState.roomCode);
  document.querySelector('.admin-shell')?.setAttribute('data-phase', phase);

  el.roomPill.textContent = `ROOM ${adminState.roomCode || '--'}`;
  el.phasePill.textContent = ui.getPhaseLabel(phase);
  el.roomCodeDisplay.textContent = adminState.roomCode || '--';
  el.playerCount.textContent = adminState.playerCount || 0;
  el.spyPool.textContent = adminState.spyPoolRemaining || 0;
  el.progressChip.textContent = progressText(phase);
  el.roomForm.classList.toggle('is-hidden', hasRoom && phase !== 'setup');

  renderTimer();
  renderPhaseLine(phase);
  renderAdminAction();
  renderButtons(phase);
  renderPlayers();
  renderRoundData();
  renderLeaderboard();
}

function renderAdminAction() {
  const action = ui.getAdminPrimaryAction(adminState || {});
  el.actionTitle.textContent = action.label;
  el.actionHint.textContent = action.hint;
  el.actionCard.dataset.tone = action.tone;
}

function renderButtons(phase) {
  const hasRoom = Boolean(adminState.roomCode);
  const action = ui.getAdminPrimaryAction(adminState || {});
  const canStart = hasRoom && phase === 'lobby' && adminState.playerCount > 0 && adminState.spyPoolRemaining > 0;

  el.roundForm.classList.toggle('is-hidden', phase !== 'lobby');
  el.startRoundButton.disabled = !canStart;
  el.forceDescriptionButton.disabled = phase !== 'description';
  el.openVoteButton.disabled = phase !== 'summary';
  el.forceVoteButton.disabled = phase !== 'voting';
  el.nextRoundButton.disabled = phase !== 'result' || adminState.spyPoolRemaining === 0;
  el.endGameButton.disabled = !hasRoom || adminState.playerCount === 0;
  el.resetButton.disabled = !hasRoom;
  el.spyCount.max = Math.max(1, adminState.spyPoolRemaining || 1);

  phaseButtons.forEach((button) => {
    const isPrimary = button.id === action.buttonId;
    button.classList.toggle('is-hidden', !isPrimary);
    button.classList.toggle('is-current-action', isPrimary);
  });

  el.endGameButton.classList.toggle('is-current-action', action.buttonId === 'end-game-button');
}

function renderPhaseLine(phase) {
  el.phaseLine.innerHTML = ui
    .getPhaseSteps(phase)
    .map(
      (step) => `<span class="phase-step ${step.active ? 'active' : ''} ${step.complete ? 'complete' : ''}">${step.label}</span>`
    )
    .join('');
}

function renderPlayers() {
  const rows = adminState.players || [];
  if (!rows.length) {
    el.playerList.innerHTML = '<div class="player-row"><span class="muted">Chưa có người chơi.</span></div>';
    return;
  }

  el.playerList.innerHTML = rows
    .map(
      (player) => `
        <div class="player-row">
          <span>
            <strong>${escapeHtml(player.name)}</strong>
            <span class="muted">${roleLabel(player.role)} · ${player.connected ? 'online' : 'offline'}</span>
          </span>
          <span>${player.score} điểm</span>
          <button class="danger" type="button" data-kick="${player.id}">Xóa</button>
        </div>
      `
    )
    .join('');

  el.playerList.querySelectorAll('[data-kick]').forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await emitAck('admin:kick_player', { playerId: button.dataset.kick });
      setMessage(el.roomMessage, result.ok ? 'Đã xóa người chơi.' : result.message, result.ok ? 'done' : '');
    });
  });
}

function renderRoundData() {
  const round = adminState.currentRound;
  if (!round) {
    el.roundData.innerHTML = '<div class="description-row"><span class="muted">Chưa có vòng đang chạy.</span></div>';
    return;
  }

  const blocks = [];
  blocks.push(`
    <div class="description-row">
      <strong>Vòng ${round.number}</strong>
      <span>${round.spyCount} Gián điệp</span>
      <span>${adminState.spyPoolRemaining} còn lại</span>
    </div>
  `);

  if (round.spyNames?.length) {
    blocks.push(`
      <div class="description-row">
        <strong>Gián điệp</strong>
        <span>${round.spyNames.map(escapeHtml).join(', ')}</span>
        <span class="muted">ẩn với người chơi</span>
      </div>
    `);
  }

  for (const row of round.descriptions || []) {
    blocks.push(`
      <div class="description-row">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(row.text)}</span>
        <span class="muted">${row.auto ? 'tự động' : 'đã nộp'}</span>
      </div>
    `);
  }

  if (round.result) {
    for (const row of round.result.playerResults) {
      blocks.push(`
        <div class="result-row">
          <strong>${row.role === 'SPY' ? 'SPY' : 'DÂN'}</strong>
          <span>${escapeHtml(row.name)}</span>
          <span class="${row.delta >= 0 ? 'delta-plus' : 'delta-minus'}">${formatDelta(row.delta)}</span>
        </div>
      `);
    }
  }

  el.roundData.innerHTML = blocks.join('');
}

function renderLeaderboard() {
  const rows = adminState.leaderboard || [];
  if (!rows.length) {
    el.leaderboard.innerHTML = '<div class="rank-row"><span class="muted">Chưa có điểm.</span></div>';
    return;
  }

  el.leaderboard.innerHTML = rows
    .map(
      (row, index) => `
        <div class="rank-row">
          <strong>#${index + 1}</strong>
          <span>${escapeHtml(row.name)} <span class="muted">${row.correctGuesses} đúng</span></span>
          <span>${row.score} điểm</span>
        </div>
      `
    )
    .join('');
}

function renderTimer() {
  if (!timerState || timerState.remaining <= 0) {
    el.timerPill.textContent = '--';
    return;
  }
  el.timerPill.textContent = `${timerState.phase === 'description' ? 'Mô tả' : 'Vote'}: ${timerState.remaining}s`;
}

function progressText(phase) {
  const round = adminState.currentRound;
  const playerCount = adminState.playerCount || 0;
  if (!round || !playerCount) return `${playerCount} người`;
  if (phase === 'description') return `${round.descriptionsSubmitted || 0}/${playerCount} mô tả`;
  if (phase === 'voting') return `${round.votesSubmitted || 0}/${playerCount} vote`;
  return `Vòng ${round.number}`;
}

function emitAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response || { ok: true }));
  });
}

function setMessage(node, text, tone = '') {
  node.textContent = text || '';
  node.classList.remove('tone-neutral', 'tone-warning', 'tone-ready', 'tone-done');
  if (tone) node.classList.add(`tone-${tone}`);
}

function roleLabel(role) {
  return {
    SPY: 'Gián điệp',
    CIVILIAN: 'Dân thường',
    WAITING: 'Chờ vòng',
  }[role] || role;
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : String(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
