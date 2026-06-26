const socket = io();
const ui = window.SpyGameUI;

const TOKEN_KEY = 'spyGamePlayerToken';
const NAME_KEY = 'spyGamePlayerName';
const ROOM_KEY = 'spyGameRoomCode';

let roomState = null;
let playerState = null;
let timerState = null;
let lastDescriptionRoundNumber = null;

const el = {
  roomPill: document.getElementById('room-pill'),
  scorePill: document.getElementById('score-pill'),
  timerPill: document.getElementById('timer-pill'),
  joinForm: document.getElementById('join-form'),
  roomCode: document.getElementById('room-code'),
  playerName: document.getElementById('player-name'),
  lobbyMessage: document.getElementById('lobby-message'),
  waitingMessage: document.getElementById('waiting-message'),
  waitingRoster: document.getElementById('waiting-roster'),
  phaseLine: document.getElementById('phase-line'),
  roleBadge: document.getElementById('role-badge'),
  secretKeyword: document.getElementById('secret-keyword'),
  descriptionForm: document.getElementById('description-form'),
  descriptionInput: document.getElementById('description-input'),
  descriptionMessage: document.getElementById('description-message'),
  descriptionSummary: document.getElementById('description-summary'),
  voteForm: document.getElementById('vote-form'),
  voteGrid: document.getElementById('vote-grid'),
  voteMeter: document.getElementById('vote-meter'),
  voteMessage: document.getElementById('vote-message'),
  voteSubmit: document.getElementById('vote-submit'),
  spyReveal: document.getElementById('spy-reveal'),
  roundResult: document.getElementById('round-result'),
  leaderboard: document.getElementById('leaderboard'),
  podium: document.getElementById('podium'),
  finalRanks: document.getElementById('final-ranks'),
};

el.roomCode.value = localStorage.getItem(ROOM_KEY) || '';
el.playerName.value = localStorage.getItem(NAME_KEY) || '';

el.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const roomCode = el.roomCode.value.trim();
  const name = el.playerName.value.trim();
  if (!roomCode || !name) {
    setMessage(el.lobbyMessage, 'Nhập đủ mã phòng và tên hiển thị.');
    return;
  }

  const token = localStorage.getItem(TOKEN_KEY) || createToken();
  const result = await emitAck('player:join', { roomCode, name, token });
  if (!result.ok) {
    setMessage(el.lobbyMessage, result.message);
    return;
  }

  localStorage.setItem(TOKEN_KEY, result.token);
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(ROOM_KEY, roomCode.toUpperCase());
  setMessage(el.lobbyMessage, '');
});

el.descriptionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = el.descriptionInput.value.trim();
  if (!text) {
    setMessage(el.descriptionMessage, 'Nhập mô tả trước khi nộp.');
    return;
  }

  const result = await emitAck('player:submit_description', { text });
  if (!result.ok) {
    setMessage(el.descriptionMessage, result.message);
    return;
  }
  setMessage(el.descriptionMessage, 'Đã nộp mô tả.');
  el.descriptionInput.disabled = true;
  el.descriptionForm.querySelector('button').disabled = true;
});

el.voteGrid.addEventListener('change', () => {
  refreshVoteStatus();
});

el.voteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const checked = getCheckedVoteIds();
  const status = getCurrentVoteStatus();
  if (!status.canSubmit) {
    setMessage(el.voteMessage, status.message, status.tone);
    return;
  }

  const result = await emitAck('player:submit_vote', { targetIds: checked });
  if (!result.ok) {
    setMessage(el.voteMessage, result.message);
    return;
  }
  setMessage(el.voteMessage, 'Đã gửi bình chọn.', 'done');
  [...document.querySelectorAll('.vote-checkbox')].forEach((box) => {
    box.disabled = true;
  });
  el.voteSubmit.disabled = true;
  el.voteMeter.textContent = 'Đã gửi';
});

socket.on('room:state', (payload) => {
  roomState = payload;
  render();
});

socket.on('connect', () => {
  attemptAutoJoin();
});

socket.on('player:state', (payload) => {
  playerState = payload;
  render();
});

socket.on('timer:tick', (payload) => {
  timerState = payload;
  renderTimer();
});

socket.on('error:message', (payload) => {
  setMessage(el.lobbyMessage, payload.message || 'Có lỗi xảy ra.');
  setMessage(el.descriptionMessage, payload.message || '');
  setMessage(el.voteMessage, payload.message || '');
});

socket.on('round:description_summary', () => render());
socket.on('round:vote_opened', () => render());
socket.on('round:result', () => render());
socket.on('game:podium', () => render());

function render() {
  renderHeader();
  renderPhaseLine();

  const screenId = ui.getPlayerScreenId(playerState);
  showScreen(screenId);

  if (screenId === 'screen-lobby') return;
  if (screenId === 'screen-description') {
    renderDescriptionScreen();
  } else if (screenId === 'screen-summary') {
    renderSummary();
  } else if (screenId === 'screen-vote') {
    renderVote();
  } else if (screenId === 'screen-result') {
    renderResult();
  } else if (screenId === 'screen-podium') {
    renderPodium();
  } else {
    renderWaiting();
  }
}

async function attemptAutoJoin() {
  if (playerState?.player) return;
  const token = localStorage.getItem(TOKEN_KEY);
  const roomCode = localStorage.getItem(ROOM_KEY);
  const name = localStorage.getItem(NAME_KEY);
  if (!token || !roomCode || !name) return;

  const result = await emitAck('player:join', { roomCode, name, token });
  if (result.ok) {
    localStorage.setItem(TOKEN_KEY, result.token);
  }
}

function renderHeader() {
  const roomCode = roomState?.roomCode || playerState?.roomCode || '--';
  const score = playerState?.player?.score || 0;
  el.roomPill.textContent = `ROOM ${roomCode || '--'}`;
  el.scorePill.textContent = `${score} điểm`;
  renderTimer();
}

function renderTimer() {
  if (!timerState || timerState.remaining <= 0) {
    el.timerPill.textContent = '--';
    return;
  }
  const label = timerState.phase === 'description' ? 'Mô tả' : 'Vote';
  el.timerPill.textContent = `${label}: ${timerState.remaining}s`;
}

function renderWaiting() {
  el.waitingMessage.textContent =
    roomState?.phase === 'setup' || !roomState?.roomCode
      ? 'Chưa có phòng đang mở.'
      : 'Đã vào phòng. Chờ quản trò bắt đầu vòng.';
  el.waitingRoster.innerHTML = renderRosterRows(roomState?.players || []);
}

function renderDescriptionScreen() {
  const role = playerState.round?.role === 'SPY' ? 'GIÁN ĐIỆP' : 'DÂN THƯỜNG';
  const roundNumber = playerState.round?.number || 0;
  const submitted = Boolean(playerState.round?.description);

  el.roleBadge.textContent = role;
  el.roleBadge.classList.toggle('role-spy', playerState.round?.role === 'SPY');
  el.secretKeyword.textContent = playerState.round?.keyword || '--';
  el.descriptionInput.disabled = submitted;
  el.descriptionForm.querySelector('button').disabled = submitted;

  if (lastDescriptionRoundNumber !== roundNumber) {
    lastDescriptionRoundNumber = roundNumber;
    if (!submitted) el.descriptionInput.value = '';
  }

  if (submitted) {
    el.descriptionInput.value = playerState.round.description.text;
    setMessage(el.descriptionMessage, 'Mô tả của bạn đã được ghi nhận.', 'done');
  } else {
    setMessage(el.descriptionMessage, '');
  }
}

function renderSummary() {
  const rows = roomState?.currentRound?.descriptions || [];
  el.descriptionSummary.innerHTML = rows.length
    ? renderDescriptionRows(rows)
    : '<div class="description-row"><span class="muted">Chưa có mô tả để hiển thị.</span></div>';
}

function renderVote() {
  const expected = playerState.round?.spyCount || 0;
  const voted = Boolean(playerState.round?.vote);
  const previousSelection = new Set(
    voted ? playerState.round.vote.targetIds : getCheckedVoteIds()
  );
  const myId = playerState.player.id;

  el.voteGrid.innerHTML = (roomState?.players || [])
    .filter((player) => player.id !== myId)
    .map((player) => {
      const checked = previousSelection.has(player.id);
      return `
        <label class="vote-option ${checked ? 'is-selected' : ''}">
          <input class="vote-checkbox" type="checkbox" value="${player.id}" ${checked ? 'checked' : ''} ${voted ? 'disabled' : ''}>
          <span>${escapeHtml(player.name)}</span>
        </label>
      `;
    })
    .join('');

  refreshVoteStatus(expected, voted);
}

function refreshVoteStatus(requiredCount = playerState?.round?.spyCount || 0, voted = Boolean(playerState?.round?.vote)) {
  document.querySelectorAll('.vote-option').forEach((option) => {
    const input = option.querySelector('input');
    option.classList.toggle('is-selected', Boolean(input?.checked));
  });

  const status = getCurrentVoteStatus(requiredCount, voted);
  el.voteMeter.textContent = status.label;
  el.voteSubmit.disabled = !status.canSubmit;
  setMessage(el.voteMessage, status.message, status.tone);
}

function getCurrentVoteStatus(requiredCount = playerState?.round?.spyCount || 0, voted = Boolean(playerState?.round?.vote)) {
  return ui.getVoteStatus({
    selectedCount: getCheckedVoteIds().length,
    requiredCount,
    voted,
  });
}

function getCheckedVoteIds() {
  return [...document.querySelectorAll('.vote-checkbox:checked')].map((box) => box.value);
}

function renderResult() {
  const result = playerState.round?.result || roomState?.currentRound?.result;
  if (!result) return;

  el.spyReveal.textContent = `Gián điệp thật sự: ${result.spyNames.join(', ')}`;
  el.roundResult.innerHTML = result.playerResults
    .map(
      (row) => `
        <div class="result-row">
          <strong>${row.role === 'SPY' ? 'SPY' : 'DÂN'}</strong>
          <span>${escapeHtml(row.name)} <span class="muted">${escapeHtml(row.description)}</span></span>
          <span class="${row.delta >= 0 ? 'delta-plus' : 'delta-minus'}">${formatDelta(row.delta)}</span>
        </div>
      `
    )
    .join('');
  el.leaderboard.innerHTML = renderRankRows(result.leaderboard);
}

function renderPodium() {
  const podium = roomState?.podium;
  if (!podium) return;
  const ordered = [podium.topThree[1], podium.topThree[0], podium.topThree[2]];
  el.podium.innerHTML = ordered
    .map((row, index) => {
      if (!row) return '<div></div>';
      const rank = index === 1 ? 1 : index === 0 ? 2 : 3;
      return `
        <div class="podium-step ${rank === 1 ? 'first' : ''}">
          <strong>Hạng ${rank}</strong>
          <span>${escapeHtml(row.name)}</span>
          <span class="delta-plus">${row.score} điểm</span>
        </div>
      `;
    })
    .join('');
  el.finalRanks.innerHTML = renderRankRows(podium.rest, 4);
}

function renderPhaseLine() {
  const phase = playerState?.phase || roomState?.phase || 'setup';
  el.phaseLine.innerHTML = ui
    .getPhaseSteps(phase)
    .map(
      (step) => `<span class="phase-step ${step.active ? 'active' : ''} ${step.complete ? 'complete' : ''}">${step.label}</span>`
    )
    .join('');
}

function renderRosterRows(rows) {
  if (!rows.length) {
    return '<div class="description-row"><span class="muted">Chưa có người chơi.</span></div>';
  }

  return rows
    .map(
      (player) => `
        <div class="description-row">
          <strong>${escapeHtml(player.name)}</strong>
          <span class="muted">${player.connected ? 'online' : 'offline'}</span>
          <span>${player.score} điểm</span>
        </div>
      `
    )
    .join('');
}

function renderDescriptionRows(rows) {
  return rows
    .map(
      (row) => `
        <div class="description-row">
          <strong>${escapeHtml(row.name)}</strong>
          <span>${escapeHtml(row.text)}</span>
          <span class="muted">${row.auto ? 'tự động' : 'đã nộp'}</span>
        </div>
      `
    )
    .join('');
}

function renderRankRows(rows = [], startRank = 1) {
  if (!rows.length) {
    return '<div class="rank-row"><span class="muted">Chưa có dữ liệu.</span></div>';
  }

  return rows
    .map(
      (row, index) => `
        <div class="rank-row">
          <strong>#${startRank + index}</strong>
          <span>${escapeHtml(row.name)} <span class="muted">${row.correctGuesses} đoán đúng</span></span>
          <span>${row.score} điểm</span>
        </div>
      `
    )
    .join('');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
}

function setMessage(node, text, tone = '') {
  node.textContent = text || '';
  node.classList.remove('tone-neutral', 'tone-warning', 'tone-ready', 'tone-done');
  if (tone) node.classList.add(`tone-${tone}`);
}

function emitAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response || { ok: true }));
  });
}

function createToken() {
  return `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
