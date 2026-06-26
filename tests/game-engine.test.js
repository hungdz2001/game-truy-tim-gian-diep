const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createInitialState,
  createRoom,
  joinPlayer,
  kickPlayer,
  startRound,
  submitDescription,
  endDescriptionPhase,
  openVote,
  submitVote,
  endVotePhase,
  nextRound,
  endGame,
  getLeaderboard,
} = require('../src/game-engine');

function makeRoom(names) {
  const state = createRoom(createInitialState(), { roomCode: 'SPY-2026', now: 1000 });
  const players = names.map((name, index) =>
    joinPlayer(state, {
      roomCode: 'SPY-2026',
      name,
      token: `token-${index + 1}`,
      now: 1000 + index,
    }).player
  );

  return { state, players };
}

function completeCurrentRound(state) {
  const playerIds = state.joinOrder.filter((id) => state.players[id]);
  for (const playerId of playerIds) {
    submitDescription(state, { playerId, text: `Mô tả ${playerId}`, now: 2500 });
  }
  endDescriptionPhase(state, { now: 3000 });
  openVote(state, { now: 3100 });
  for (const voterId of playerIds) {
    submitVote(state, {
      voterId,
      targetIds: playerIds.filter((id) => id !== voterId).slice(0, state.currentRound.spyCount),
      now: 3200,
    });
  }
  endVotePhase(state, { now: 4000 });
}

test('join requires the active room code and locked lobby only allows token reconnects', () => {
  const state = createRoom(createInitialState(), { roomCode: 'SPY-2026', now: 1000 });

  assert.throws(
    () => joinPlayer(state, { roomCode: 'WRONG', name: 'Lan', token: 'lan-token', now: 1001 }),
    /Mã phòng không đúng/
  );

  const joined = joinPlayer(state, { roomCode: 'SPY-2026', name: 'Lan', token: 'lan-token', now: 1001 });
  joinPlayer(state, { roomCode: 'SPY-2026', name: 'Binh', token: 'binh-token', now: 1002 });
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tuổi trẻ',
    spyKeyword: 'Thanh xuân',
    rng: () => 0,
    now: 2000,
  });

  assert.throws(
    () => joinPlayer(state, { roomCode: 'SPY-2026', name: 'Minh', token: 'minh-token', now: 2001 }),
    /Game đã khóa/
  );

  const rejoined = joinPlayer(state, { roomCode: 'SPY-2026', name: 'Lan', token: 'lan-token', now: 2002 });
  assert.equal(rejoined.rejoined, true);
  assert.equal(rejoined.player.id, joined.player.id);
});

test('players can join the active room without entering a room code', () => {
  const state = createRoom(createInitialState(), { roomCode: 'SPY-2026', now: 1000 });

  const joined = joinPlayer(state, { name: 'Lan', token: 'lan-token', now: 1001 });

  assert.equal(joined.player.name, 'Lan');
  assert.equal(joined.player.id, 'p1');
  assert.equal(state.joinOrder.length, 1);
  joinPlayer(state, { name: 'Binh', token: 'binh-token', now: 1002 });

  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tre',
    spyKeyword: 'Xuan',
    rng: () => 0,
    now: 2000,
  });

  assert.throws(
    () => joinPlayer(state, { name: 'Minh', token: 'minh-token', now: 2001 }),
    /Game đã khóa/
  );

  const rejoined = joinPlayer(state, { name: 'Lan', token: 'lan-token', now: 2002 });
  assert.equal(rejoined.rejoined, true);
  assert.equal(rejoined.player.id, joined.player.id);
});

test('starting rounds draws spies from the spy pool without repeating until the pool is empty', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);

  const firstRound = startRound(state, {
    spyCount: 2,
    civilianKeyword: 'Tuổi trẻ',
    spyKeyword: 'Thanh xuân',
    rng: () => 0,
    now: 2000,
  });
  assert.deepEqual(firstRound.spyIds, [players[0].id, players[1].id]);
  assert.deepEqual(state.spyPool, [players[2].id]);

  completeCurrentRound(state);
  nextRound(state);
  const secondRound = startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Biển',
    spyKeyword: 'Đại dương',
    rng: () => 0,
    now: 3000,
  });
  assert.deepEqual(secondRound.spyIds, [players[2].id]);
  assert.deepEqual(state.spyPool, []);

  completeCurrentRound(state);
  nextRound(state);
  assert.throws(
    () =>
      startRound(state, {
        spyCount: 1,
        civilianKeyword: 'Nắng',
        spyKeyword: 'Mặt trời',
        rng: () => 0,
        now: 4000,
      }),
    /Pool Gián Điệp đã hết/
  );
});

test('ending description phase fills missing descriptions and applies the missing-description penalty', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tuổi trẻ',
    spyKeyword: 'Thanh xuân',
    rng: () => 0,
    now: 2000,
  });

  submitDescription(state, { playerId: players[0].id, text: 'Sức sống', now: 2100 });
  submitDescription(state, { playerId: players[1].id, text: 'Kỷ niệm', now: 2110 });
  const summary = endDescriptionPhase(state, { now: 3000 });

  assert.equal(summary.descriptions.find((row) => row.playerId === players[2].id).text, 'Không có mô tả');

  openVote(state, { now: 3100 });
  submitVote(state, { voterId: players[1].id, targetIds: [players[0].id], now: 3200 });
  submitVote(state, { voterId: players[2].id, targetIds: [players[0].id], now: 3210 });
  const result = endVotePhase(state, { now: 4000 });

  const missingPlayer = result.playerResults.find((row) => row.playerId === players[2].id);
  assert.equal(missingPlayer.missedDescription, true);
  assert.equal(missingPlayer.delta, 5);
});

test('vote submission must choose exactly spyCount targets and cannot include self', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);
  startRound(state, {
    spyCount: 2,
    civilianKeyword: 'Tuổi trẻ',
    spyKeyword: 'Thanh xuân',
    rng: () => 0,
    now: 2000,
  });
  endDescriptionPhase(state, { now: 3000 });
  openVote(state, { now: 3100 });

  assert.throws(
    () => submitVote(state, { voterId: players[2].id, targetIds: [players[0].id], now: 3200 }),
    /chọn đúng 2 người/
  );
  assert.throws(
    () =>
      submitVote(state, {
        voterId: players[2].id,
        targetIds: [players[2].id, players[0].id],
        now: 3210,
      }),
    /không thể tự chọn/
  );
});

test('votes only open after the admin opens the voting phase', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tre',
    spyKeyword: 'Xuan',
    rng: () => 0,
    now: 2000,
  });

  for (const player of players) {
    submitDescription(state, { playerId: player.id, text: `Hint ${player.name}`, now: 2500 });
  }
  endDescriptionPhase(state, { now: 3000 });

  assert.equal(state.phase, 'summary');
  assert.throws(
    () => submitVote(state, { voterId: players[1].id, targetIds: [players[0].id], now: 3100 }),
    /voting/
  );

  openVote(state, { now: 3200 });
  assert.equal(state.phase, 'voting');
  assert.doesNotThrow(() =>
    submitVote(state, { voterId: players[1].id, targetIds: [players[0].id], now: 3300 })
  );
});

test('round scoring normalizes civilian and spy role points fairly', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi', 'Dung']);
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tuổi trẻ',
    spyKeyword: 'Thanh xuân',
    rng: () => 0.26,
    now: 2000,
  });

  const spy = players[1];
  assert.deepEqual(state.currentRound.spyIds, [spy.id]);

  for (const player of players) {
    submitDescription(state, { playerId: player.id, text: `${player.name} mô tả`, now: 2100 });
  }
  endDescriptionPhase(state, { now: 3000 });
  openVote(state, { now: 3100 });

  submitVote(state, { voterId: players[0].id, targetIds: [spy.id], now: 3200 });
  submitVote(state, { voterId: players[1].id, targetIds: [players[0].id], now: 3210 });
  submitVote(state, { voterId: players[2].id, targetIds: [spy.id], now: 3220 });
  submitVote(state, { voterId: players[3].id, targetIds: [players[0].id], now: 3230 });

  const result = endVotePhase(state, { now: 4000 });
  const byId = Object.fromEntries(result.playerResults.map((row) => [row.playerId, row]));

  assert.equal(byId[players[0].id].delta, 10);
  assert.equal(byId[players[2].id].delta, 10);
  assert.equal(byId[players[3].id].delta, 0);
  assert.equal(byId[spy.id].delta, 3.3);
  assert.equal(byId[spy.id].roleScore, 3.3);
  assert.equal(byId[spy.id].behaviorPenalty, 0);
  assert.equal(byId[spy.id].votesAgainst, 2);
});

test('civilian role score is proportional to correct spy guesses', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi', 'Dung', 'Em', 'Giang']);
  startRound(state, {
    spyCount: 3,
    civilianKeyword: 'Tre',
    spyKeyword: 'Xuan',
    rng: () => 0,
    now: 2000,
  });

  for (const player of players) {
    submitDescription(state, { playerId: player.id, text: `${player.name} hint`, now: 2100 });
  }
  endDescriptionPhase(state, { now: 3000 });
  openVote(state, { now: 3100 });

  submitVote(state, {
    voterId: players[3].id,
    targetIds: [players[0].id, players[1].id, players[4].id],
    now: 3200,
  });
  for (const player of [players[0], players[1], players[2], players[4], players[5]]) {
    submitVote(state, {
      voterId: player.id,
      targetIds: [players[0].id, players[1].id, players[2].id].filter((id) => id !== player.id).concat(players[3].id).slice(0, 3),
      now: 3210,
    });
  }

  const result = endVotePhase(state, { now: 4000 });
  const civilian = result.playerResults.find((row) => row.playerId === players[3].id);

  assert.equal(civilian.correctGuessCount, 2);
  assert.equal(civilian.roleScore, 6.7);
  assert.equal(civilian.behaviorPenalty, 0);
  assert.equal(civilian.delta, 6.7);
});

test('missing vote applies a behavior penalty without blocking role points', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tre',
    spyKeyword: 'Xuan',
    rng: () => 0,
    now: 2000,
  });

  for (const player of players) {
    submitDescription(state, { playerId: player.id, text: `${player.name} hint`, now: 2100 });
  }
  endDescriptionPhase(state, { now: 3000 });
  openVote(state, { now: 3100 });
  submitVote(state, { voterId: players[2].id, targetIds: [players[0].id], now: 3200 });

  const result = endVotePhase(state, { now: 4000 });
  const missingVoter = result.playerResults.find((row) => row.playerId === players[1].id);

  assert.equal(missingVoter.missedVote, true);
  assert.equal(missingVoter.roleScore, 0);
  assert.equal(missingVoter.behaviorPenalty, -5);
  assert.equal(missingVoter.delta, -5);
});

test('missing both description and vote applies both behavior penalties', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tre',
    spyKeyword: 'Xuan',
    rng: () => 0,
    now: 2000,
  });

  submitDescription(state, { playerId: players[0].id, text: 'Spy hint', now: 2100 });
  submitDescription(state, { playerId: players[2].id, text: 'Civilian hint', now: 2110 });
  endDescriptionPhase(state, { now: 3000 });
  openVote(state, { now: 3100 });
  submitVote(state, { voterId: players[2].id, targetIds: [players[0].id], now: 3200 });

  const result = endVotePhase(state, { now: 4000 });
  const inactivePlayer = result.playerResults.find((row) => row.playerId === players[1].id);

  assert.equal(inactivePlayer.missedDescription, true);
  assert.equal(inactivePlayer.missedVote, true);
  assert.equal(inactivePlayer.roleScore, 0);
  assert.equal(inactivePlayer.behaviorPenalty, -10);
  assert.equal(inactivePlayer.delta, -10);
});

test('starting a round rejects spy count that leaves no civilians', () => {
  const { state } = makeRoom(['An', 'Binh']);

  assert.throws(
    () =>
      startRound(state, {
        spyCount: 2,
        civilianKeyword: 'Tre',
        spyKeyword: 'Xuan',
        rng: () => 0,
        now: 2000,
      }),
    /nhỏ hơn số người chơi/
  );
});

test('podium sorting uses score, correct guesses, then earlier join order', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi', 'Dung']);
  state.players[players[0].id].score = 20;
  state.players[players[0].id].correctGuesses = 1;
  state.players[players[1].id].score = 30;
  state.players[players[1].id].correctGuesses = 1;
  state.players[players[2].id].score = 20;
  state.players[players[2].id].correctGuesses = 2;
  state.players[players[3].id].score = 20;
  state.players[players[3].id].correctGuesses = 2;

  const podium = endGame(state, { now: 9000 });

  assert.deepEqual(
    podium.topThree.map((row) => row.name),
    ['Binh', 'Chi', 'Dung']
  );
  assert.deepEqual(
    getLeaderboard(state).map((row) => row.name),
    ['Binh', 'Chi', 'Dung', 'An']
  );
});

test('kicking a player removes them from players, join order, and spy pool', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);

  kickPlayer(state, { playerId: players[1].id });

  assert.equal(state.players[players[1].id], undefined);
  assert.equal(state.joinOrder.includes(players[1].id), false);
  assert.equal(state.spyPool.includes(players[1].id), false);
});

test('kicking a player clears their round data and removes them from vote targets', () => {
  const { state, players } = makeRoom(['An', 'Binh', 'Chi']);
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tre',
    spyKeyword: 'Xuan',
    rng: () => 0,
    now: 2000,
  });

  for (const player of players) {
    submitDescription(state, { playerId: player.id, text: `Hint ${player.name}`, now: 2500 });
  }
  endDescriptionPhase(state, { now: 3000 });
  openVote(state, { now: 3100 });
  submitVote(state, { voterId: players[0].id, targetIds: [players[1].id], now: 3200 });
  submitVote(state, { voterId: players[1].id, targetIds: [players[0].id], now: 3201 });

  kickPlayer(state, { playerId: players[1].id });

  assert.equal(state.currentRound.descriptions[players[1].id], undefined);
  assert.equal(state.currentRound.votes[players[1].id], undefined);
  assert.deepEqual(state.currentRound.votes[players[0].id].targetIds, []);
});

test('creating a room replaces any active game state with a fresh game', () => {
  const { state } = makeRoom(['An', 'Binh', 'Chi']);
  startRound(state, {
    spyCount: 1,
    civilianKeyword: 'Tre',
    spyKeyword: 'Xuan',
    rng: () => 0,
    now: 2000,
  });

  createRoom(state, { roomCode: 'SPY-9999', now: 5000 });

  assert.equal(state.roomCode, 'SPY-9999');
  assert.equal(state.phase, 'lobby');
  assert.equal(state.roundNumber, 0);
  assert.equal(state.currentRound, null);
  assert.equal(state.joinOrder.length, 0);
  assert.deepEqual(state.players, {});
  assert.deepEqual(state.playerTokens, {});
  assert.deepEqual(state.spyPool, []);
});
