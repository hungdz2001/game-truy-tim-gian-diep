const socket = io();

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
  roomForm: document.getElementById('room-form'),
  roomCodeInput: document.getElementById('room-code-input'),
  roomCodeDisplay: document.getElementById('room-code-display'),
  roomMessage: document.getElementById('room-message'),
  resetButton: document.getElementById('reset-button'),
  endGameButton: document.getElementById('end-game-button'),
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

el.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await emitAck('admin:auth', { pin: el.adminPin.value.trim() });
  if (!result.ok) {
    setMessage(el.authMessage, result.message);
    return;
  }
  adminAuthed = true;
  adminState = result.state;
  el.authPanel.style.display = 'none';
  el.adminApp.style.display = 'block';
  render();
});

el.roomForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await emitAck('admin:create_room', { roomCode: el.roomCodeInput.value.trim() });
  setMessage(el.roomMessage, result.ok ? `Đã tạo phòng ${result.roomCode}.` : result.message);
});

el.roundForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await emitAck('admin:start_round', {
    spyCount: Number(el.spyCount.value),
    civilianKeyword: el.civilianKeyword.value.trim(),
    spyKeyword: el.spyKeyword.value.trim(),
  });
  setMessage(el.roundMessage, result.ok ? `Đã bắt đầu vòng ${result.roundNumber}.` : result.message);
});

el.forceDescriptionButton.addEventListener('click', async () => {
  const result = await emitAck('admin:force_description_end', {});
  setMessage(el.roundMessage, result.ok ? 'Đã khóa mô tả.' : result.message);
});

el.openVoteButton.addEventListener('click', async () => {
  const result = await emitAck('admin:open_vote', {});
  setMessage(el.roundMessage, result.ok ? 'Đã mở vote.' : result.message);
});

el.forceVoteButton.addEventListener('click', async () => {
  const result = await emitAck('admin:force_vote_end', {});
  setMessage(el.roundMessage, result.ok ? 'Đã khóa vote.' : result.message);
});

el.nextRoundButton.addEventListener('click', async () => {
  const result = await emitAck('admin:next_round', {});
  setMessage(el.roundMessage, result.ok ? 'Đã chuyển sang vòng mới.' : result.message);
});

el.endGameButton.addEventListener('click', async () => {
  const result = await emitAck('admin:end_game', {});
  setMessage(el.roomMessage, result.ok ? 'Đã tổng kết game.' : result.message);
});

el.resetButton.addEventListener('click', async () => {
  if (!confirm('Reset toàn bộ game hiện tại?')) return;
  const result = await emitAck('admin:reset_game', {});
  setMessage(el.roomMessage, result.ok ? 'Đã reset game.' : result.message);
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
  el.roomPill.textContent = `ROOM ${adminState.roomCode || '--'}`;
  el.phasePill.textContent = phaseLabel(phase);
  el.roomCodeDisplay.textContent = adminState.roomCode || '--';
  renderTimer();
  renderButtons(phase);
  renderPlayers();
  renderRoundData();
  renderLeaderboard();
}

function renderButtons(phase) {
  const hasRoom = Boolean(adminState.roomCode);
  const canStart = hasRoom && phase === 'lobby' && adminState.spyPoolRemaining > 0;
  el.startRoundButton.disabled = !canStart;
  el.forceDescriptionButton.disabled = phase !== 'description';
  el.openVoteButton.disabled = phase !== 'summary';
  el.forceVoteButton.disabled = phase !== 'voting';
  el.nextRoundButton.disabled = phase !== 'result' || adminState.spyPoolRemaining === 0;
  el.endGameButton.disabled = !hasRoom || adminState.playerCount === 0;
  el.endGameButton.classList.toggle('success', adminState.spyPoolRemaining === 0 && hasRoom);
  el.spyCount.max = Math.max(1, adminState.spyPoolRemaining || 1);
}

function renderPlayers() {
  el.playerList.innerHTML = (adminState.players || [])
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
      setMessage(el.roomMessage, result.ok ? 'Đã xóa người chơi.' : result.message);
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
        <span>ẩn với người chơi</span>
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
  el.leaderboard.innerHTML = (adminState.leaderboard || [])
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

function emitAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response || { ok: true }));
  });
}

function setMessage(node, text) {
  node.textContent = text || '';
}

function phaseLabel(phase) {
  return {
    setup: 'Chưa tạo phòng',
    lobby: 'Phòng chờ',
    description: 'Đang mô tả',
    summary: 'Bảng mô tả',
    voting: 'Đang vote',
    result: 'Kết quả',
    gameOver: 'Tổng kết',
  }[phase] || phase;
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
