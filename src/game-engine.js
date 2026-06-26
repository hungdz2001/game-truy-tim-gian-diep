const DEFAULT_DESCRIPTION = 'Không có mô tả';

function createInitialState() {
  return {
    roomCode: null,
    phase: 'setup',
    lobbyLocked: false,
    createdAt: null,
    roundNumber: 0,
    nextPlayerNumber: 1,
    players: {},
    playerTokens: {},
    joinOrder: [],
    spyPool: [],
    currentRound: null,
    roundHistory: [],
    podium: null,
  };
}

function createRoom(state, { roomCode, now = Date.now() }) {
  const fresh = createInitialState();
  Object.assign(state, fresh, {
    roomCode: normalizeRoomCode(roomCode),
    phase: 'lobby',
    createdAt: now,
  });
  return state;
}

function joinPlayer(state, { roomCode, name, token, now = Date.now() }) {
  assertRoom(state);
  if (normalizeRoomCode(roomCode) !== state.roomCode) {
    throw new Error('Mã phòng không đúng.');
  }

  const cleanName = normalizeName(name);
  const cleanToken = String(token || '').trim() || `token-${now}-${state.nextPlayerNumber}`;
  const existingId = state.playerTokens[cleanToken];

  if (existingId && state.players[existingId]) {
    const player = state.players[existingId];
    player.name = cleanName;
    player.connected = true;
    return { player: publicPlayer(player), token: cleanToken, rejoined: true };
  }

  if (state.lobbyLocked) {
    throw new Error('Phòng đã khóa, người chơi mới không thể tham gia.');
  }

  const id = `p${state.nextPlayerNumber++}`;
  const player = {
    id,
    token: cleanToken,
    name: cleanName,
    score: 0,
    correctGuesses: 0,
    joinedAt: now,
    connected: true,
  };

  state.players[id] = player;
  state.playerTokens[cleanToken] = id;
  state.joinOrder.push(id);
  state.spyPool.push(id);

  return { player: publicPlayer(player), token: cleanToken, rejoined: false };
}

function kickPlayer(state, { playerId }) {
  const player = state.players[playerId];
  if (!player) return false;

  delete state.playerTokens[player.token];
  delete state.players[playerId];
  state.joinOrder = state.joinOrder.filter((id) => id !== playerId);
  state.spyPool = state.spyPool.filter((id) => id !== playerId);

  if (state.currentRound) {
    delete state.currentRound.descriptions[playerId];
    delete state.currentRound.votes[playerId];
  }

  return true;
}

function markDisconnected(state, { playerId }) {
  if (state.players[playerId]) {
    state.players[playerId].connected = false;
  }
}

function startRound(
  state,
  { spyCount, civilianKeyword, spyKeyword, rng = Math.random, now = Date.now() }
) {
  assertRoom(state);
  if (state.phase !== 'lobby' && state.phase !== 'result') {
    throw new Error('Chỉ có thể bắt đầu vòng mới từ phòng chờ hoặc sau kết quả vòng.');
  }
  if (state.phase === 'result') {
    nextRound(state);
  }

  const cleanSpyCount = Number(spyCount);
  if (!Number.isInteger(cleanSpyCount) || cleanSpyCount < 1) {
    throw new Error('Số Gián điệp phải là số nguyên từ 1 trở lên.');
  }
  if (state.spyPool.length === 0) {
    throw new Error('Pool Gián Điệp đã hết. Hãy tổng kết game.');
  }
  if (cleanSpyCount > state.spyPool.length) {
    throw new Error(`Số Gián điệp không được lớn hơn pool còn lại (${state.spyPool.length}).`);
  }

  const cleanCivilianKeyword = normalizeKeyword(civilianKeyword, 'Từ khóa Dân thường');
  const cleanSpyKeyword = normalizeKeyword(spyKeyword, 'Từ khóa Gián điệp');
  const spyIds = drawSpies(state.spyPool, cleanSpyCount, rng);

  state.spyPool = state.spyPool.filter((id) => !spyIds.includes(id));
  state.lobbyLocked = true;
  state.phase = 'description';
  state.currentRound = {
    number: ++state.roundNumber,
    spyCount: cleanSpyCount,
    civilianKeyword: cleanCivilianKeyword,
    spyKeyword: cleanSpyKeyword,
    spyIds,
    startedAt: now,
    status: 'description',
    descriptions: {},
    votes: {},
    result: null,
  };
  state.podium = null;

  return state.currentRound;
}

function submitDescription(state, { playerId, text, now = Date.now() }) {
  const round = assertCurrentRound(state, 'description');
  assertPlayer(state, playerId);

  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error('Mô tả không được trống.');
  }

  round.descriptions[playerId] = {
    playerId,
    text: cleanText,
    auto: false,
    submittedAt: now,
  };

  return round.descriptions[playerId];
}

function endDescriptionPhase(state, { now = Date.now() } = {}) {
  const round = assertCurrentRound(state, 'description');

  for (const playerId of activePlayerIds(state)) {
    if (!round.descriptions[playerId]) {
      round.descriptions[playerId] = {
        playerId,
        text: DEFAULT_DESCRIPTION,
        auto: true,
        submittedAt: now,
      };
    }
  }

  state.phase = 'summary';
  round.status = 'summary';
  round.descriptionEndedAt = now;

  return getDescriptionSummary(state);
}

function openVote(state, { now = Date.now() } = {}) {
  const round = assertCurrentRound(state, 'summary');
  state.phase = 'voting';
  round.status = 'voting';
  round.voteOpenedAt = now;
  round.votes = {};
  return getVotePayload(state);
}

function submitVote(state, { voterId, targetIds, now = Date.now() }) {
  const round = assertCurrentRound(state, 'voting');
  assertPlayer(state, voterId);

  if (!Array.isArray(targetIds)) {
    throw new Error('Danh sách bình chọn không hợp lệ.');
  }

  const uniqueTargets = [...new Set(targetIds.map(String))];
  if (uniqueTargets.length !== round.spyCount) {
    throw new Error(`Bạn phải chọn đúng ${round.spyCount} người.`);
  }
  if (uniqueTargets.includes(voterId)) {
    throw new Error('Bạn không thể tự chọn chính mình.');
  }

  for (const targetId of uniqueTargets) {
    assertPlayer(state, targetId);
  }

  round.votes[voterId] = {
    voterId,
    targetIds: uniqueTargets,
    submittedAt: now,
  };

  return round.votes[voterId];
}

function endVotePhase(state, { now = Date.now() } = {}) {
  const round = assertCurrentRound(state, 'voting');
  const spySet = new Set(round.spyIds);
  const voteCounts = {};

  for (const vote of Object.values(round.votes)) {
    for (const targetId of vote.targetIds) {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    }
  }

  const playerResults = activePlayerIds(state).map((playerId) => {
    const player = state.players[playerId];
    const role = spySet.has(playerId) ? 'SPY' : 'CIVILIAN';
    const description = round.descriptions[playerId];
    const vote = round.votes[playerId];
    const missedDescription = Boolean(description && description.auto);
    const correctTargets =
      role === 'CIVILIAN' && vote
        ? vote.targetIds.filter((targetId) => spySet.has(targetId))
        : [];
    const correctGuessCount = correctTargets.length;
    const votesAgainst = voteCounts[playerId] || 0;

    let delta = 0;
    if (missedDescription) delta -= 5;
    if (role === 'CIVILIAN') delta += correctGuessCount * 10;
    if (role === 'SPY') delta -= votesAgainst * 5;

    player.score += delta;
    player.correctGuesses += correctGuessCount;

    return {
      playerId,
      name: player.name,
      role,
      description: description ? description.text : DEFAULT_DESCRIPTION,
      missedDescription,
      votedTargetIds: vote ? vote.targetIds : [],
      correctGuessCount,
      votesAgainst,
      delta,
      score: player.score,
      correctGuesses: player.correctGuesses,
    };
  });

  const result = {
    roundNumber: round.number,
    spyIds: [...round.spyIds],
    spyNames: round.spyIds.map((id) => state.players[id]?.name || 'Ẩn danh'),
    playerResults,
    leaderboard: getLeaderboard(state),
    endedAt: now,
  };

  round.result = result;
  round.status = 'result';
  state.phase = 'result';
  state.roundHistory.push(result);

  return result;
}

function nextRound(state) {
  if (state.phase !== 'result') {
    throw new Error('Chỉ có thể sang vòng mới sau khi đã có kết quả vòng.');
  }
  state.phase = 'lobby';
  state.currentRound = null;
  return state;
}

function endGame(state, { now = Date.now() } = {}) {
  const leaderboard = getLeaderboard(state);
  const podium = {
    endedAt: now,
    topThree: leaderboard.slice(0, 3),
    rest: leaderboard.slice(3),
    leaderboard,
  };

  state.phase = 'gameOver';
  state.podium = podium;
  return podium;
}

function getDescriptionSummary(state) {
  const round = assertRoundExists(state);
  return {
    roundNumber: round.number,
    spyCount: round.spyCount,
    descriptions: activePlayerIds(state).map((playerId) => ({
      playerId,
      name: state.players[playerId].name,
      text: round.descriptions[playerId]?.text || DEFAULT_DESCRIPTION,
      auto: Boolean(round.descriptions[playerId]?.auto),
    })),
  };
}

function getVotePayload(state) {
  const round = assertRoundExists(state);
  return {
    roundNumber: round.number,
    spyCount: round.spyCount,
    targetList: activePlayerIds(state).map((playerId) => ({
      id: playerId,
      name: state.players[playerId].name,
    })),
  };
}

function getLeaderboard(state) {
  return activePlayerIds(state)
    .map((playerId) => {
      const player = state.players[playerId];
      return {
        id: player.id,
        name: player.name,
        score: player.score,
        correctGuesses: player.correctGuesses,
        joinedAt: player.joinedAt,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.correctGuesses !== a.correctGuesses) return b.correctGuesses - a.correctGuesses;
      return a.joinedAt - b.joinedAt;
    });
}

function getPlayerRoundState(state, playerId) {
  const player = assertPlayer(state, playerId);
  const round = state.currentRound;
  const base = {
    player: publicPlayer(player),
    roomCode: state.roomCode,
    phase: state.phase,
    lobbyLocked: state.lobbyLocked,
    spyPoolRemaining: state.spyPool.length,
    leaderboard: getLeaderboard(state),
  };

  if (!round) return base;

  const role = getRoleForPlayer(round, playerId);
  return {
    ...base,
    round: {
      number: round.number,
      spyCount: round.spyCount,
      role,
      keyword: role === 'SPY' ? round.spyKeyword : round.civilianKeyword,
      description: round.descriptions[playerId] || null,
      vote: round.votes[playerId] || null,
      result: round.result,
    },
  };
}

function getAdminState(state) {
  return {
    roomCode: state.roomCode,
    phase: state.phase,
    lobbyLocked: state.lobbyLocked,
    roundNumber: state.roundNumber,
    spyPoolRemaining: state.spyPool.length,
    playerCount: activePlayerIds(state).length,
    players: activePlayerIds(state).map((id) => {
      const player = state.players[id];
      const role = state.currentRound ? getRoleForPlayer(state.currentRound, id) : 'WAITING';
      return {
        id: player.id,
        name: player.name,
        score: player.score,
        correctGuesses: player.correctGuesses,
        connected: player.connected,
        role,
      };
    }),
    currentRound: state.currentRound
      ? {
          number: state.currentRound.number,
          spyCount: state.currentRound.spyCount,
          spyIds: [...state.currentRound.spyIds],
          spyNames: state.currentRound.spyIds.map((id) => state.players[id]?.name || 'Ẩn danh'),
          descriptions: getDescriptionRowsIfAvailable(state),
          votesSubmitted: Object.keys(state.currentRound.votes).length,
          descriptionsSubmitted: Object.values(state.currentRound.descriptions).filter((row) => !row.auto)
            .length,
          result: state.currentRound.result,
        }
      : null,
    leaderboard: getLeaderboard(state),
    podium: state.podium,
  };
}

function allDescriptionsSubmitted(state) {
  const round = state.currentRound;
  return Boolean(
    round &&
      state.phase === 'description' &&
      activePlayerIds(state).every((playerId) => round.descriptions[playerId])
  );
}

function allVotesSubmitted(state) {
  const round = state.currentRound;
  return Boolean(
    round &&
      state.phase === 'voting' &&
      activePlayerIds(state).every((playerId) => round.votes[playerId])
  );
}

function activePlayerIds(state) {
  return state.joinOrder.filter((id) => state.players[id]);
}

function drawSpies(spyPool, spyCount, rng) {
  const pool = [...spyPool];
  const spies = [];

  for (let i = 0; i < spyCount; i += 1) {
    const raw = Number(rng());
    const safeRandom = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    const index = Math.floor(safeRandom * pool.length);
    spies.push(pool.splice(index, 1)[0]);
  }

  return spies;
}

function getDescriptionRowsIfAvailable(state) {
  if (!state.currentRound) return [];
  if (!['summary', 'voting', 'result'].includes(state.phase)) return [];
  return getDescriptionSummary(state).descriptions;
}

function getRoleForPlayer(round, playerId) {
  return round.spyIds.includes(playerId) ? 'SPY' : 'CIVILIAN';
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    correctGuesses: player.correctGuesses,
    joinedAt: player.joinedAt,
  };
}

function normalizeRoomCode(roomCode) {
  const value = String(roomCode || '').trim().toUpperCase();
  if (!value) {
    throw new Error('Mã phòng không được trống.');
  }
  return value;
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value) {
    throw new Error('Tên người chơi không được trống.');
  }
  return value;
}

function normalizeKeyword(keyword, label) {
  const value = String(keyword || '').trim();
  if (!value) {
    throw new Error(`${label} không được trống.`);
  }
  return value;
}

function assertRoom(state) {
  if (!state || !state.roomCode) {
    throw new Error('Chưa tạo phòng chơi.');
  }
}

function assertRoundExists(state) {
  if (!state.currentRound) {
    throw new Error('Chưa có vòng chơi hiện tại.');
  }
  return state.currentRound;
}

function assertCurrentRound(state, expectedPhase) {
  const round = assertRoundExists(state);
  if (state.phase !== expectedPhase) {
    throw new Error(`Vòng hiện tại không ở trạng thái ${expectedPhase}.`);
  }
  return round;
}

function assertPlayer(state, playerId) {
  const player = state.players[playerId];
  if (!player) {
    throw new Error('Người chơi không tồn tại.');
  }
  return player;
}

module.exports = {
  DEFAULT_DESCRIPTION,
  createInitialState,
  createRoom,
  joinPlayer,
  kickPlayer,
  markDisconnected,
  startRound,
  submitDescription,
  endDescriptionPhase,
  openVote,
  submitVote,
  endVotePhase,
  nextRound,
  endGame,
  getDescriptionSummary,
  getVotePayload,
  getLeaderboard,
  getPlayerRoundState,
  getAdminState,
  allDescriptionsSubmitted,
  allVotesSubmitted,
};
