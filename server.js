const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

const {
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
  getAdminState,
  getDescriptionSummary,
  getPlayerRoundState,
  getLeaderboard,
  allDescriptionsSubmitted,
  allVotesSubmitted,
} = require('./src/game-engine');
const { loadState, saveState } = require('./src/persistence');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '2468';
const STATE_PATH = path.join(__dirname, 'runtime', 'game-state.json');
const DESCRIPTION_SECONDS = 90;
const VOTE_SECONDS = 60;

let state = loadState(STATE_PATH, createInitialState);
let activeTimer = null;

app.use(express.static(path.resolve(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.resolve(__dirname, 'public', 'index.html')));
app.get('/admin', (_req, res) => res.sendFile(path.resolve(__dirname, 'public', 'admin.html')));

io.on('connection', (socket) => {
  socket.emit('room:state', getPublicRoomState());

  socket.on('admin:auth', (data = {}, reply) => {
    handleSocketAction(socket, reply, () => {
      if (String(data.pin || '') !== ADMIN_PIN) {
        throw new Error('PIN quản trò không đúng.');
      }
      socket.data.isAdmin = true;
      socket.emit('admin:state', getAdminState(state));
      return { ok: true, state: getAdminState(state) };
    });
  });

  socket.on('admin:create_room', (data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      clearActiveTimer();
      clearPlayerSockets('Game mới đã được tạo. Nhập tên để tham gia lại.');
      createRoom(state, {
        roomCode: data.roomCode || generateRoomCode(),
        now: Date.now(),
      });
      persistAndBroadcast();
      return { ok: true, roomCode: state.roomCode };
    });
  });

  socket.on('admin:kick_player', (data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      const playerId = String(data.playerId || '');
      const kicked = kickPlayer(state, { playerId });
      if (!kicked) {
        throw new Error('Người chơi không tồn tại.');
      }
      clearPlayerSocket(playerId, 'Bạn đã bị quản trò xóa khỏi game.');
      persistAndBroadcast();
      return { ok: true, kicked: true };
    });
  });

  socket.on('admin:start_round', (data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      const round = startRound(state, {
        spyCount: Number(data.spyCount),
        civilianKeyword: data.civilianKeyword,
        spyKeyword: data.spyKeyword,
        now: Date.now(),
      });
      persistState();
      emitDescriptionOpened();
      startPhaseTimer('description', DESCRIPTION_SECONDS, finishDescriptionPhase);
      broadcastState();
      return { ok: true, roundNumber: round.number };
    });
  });

  socket.on('admin:force_description_end', (_data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      finishDescriptionPhase();
      return { ok: true };
    });
  });

  socket.on('admin:open_vote', (_data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      const payload = openVoteForAll();
      return { ok: true, payload };
    });
  });

  socket.on('admin:force_vote_end', (_data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      finishVotePhase();
      return { ok: true };
    });
  });

  socket.on('admin:next_round', (_data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      nextRound(state);
      persistAndBroadcast();
      return { ok: true };
    });
  });

  socket.on('admin:end_game', (_data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      clearActiveTimer();
      const podium = endGame(state, { now: Date.now() });
      persistState();
      io.emit('game:podium', podium);
      broadcastState();
      return { ok: true, podium };
    });
  });

  socket.on('admin:reset_game', (_data = {}, reply) => {
    handleAdminAction(socket, reply, () => {
      clearActiveTimer();
      clearPlayerSockets('Game đã được reset. Nhập tên để tham gia lại.');
      state = createInitialState();
      persistAndBroadcast();
      return { ok: true };
    });
  });

  socket.on('player:join', (data = {}, reply) => {
    handleSocketAction(socket, reply, () => {
      const joined = joinPlayer(state, {
        roomCode: data.roomCode,
        name: data.name,
        token: data.token,
        now: Date.now(),
      });
      socket.data.playerId = joined.player.id;
      socket.data.playerToken = joined.token;
      socket.emit('player:state', getPlayerRoundState(state, joined.player.id));
      persistAndBroadcast();
      return { ok: true, token: joined.token, player: joined.player, rejoined: joined.rejoined };
    });
  });

  socket.on('player:submit_description', (data = {}, reply) => {
    handlePlayerAction(socket, reply, () => {
      submitDescription(state, {
        playerId: socket.data.playerId,
        text: data.text,
        now: Date.now(),
      });
      persistState();
      if (allDescriptionsSubmitted(state)) {
        finishDescriptionPhase();
      } else {
        broadcastState();
      }
      return { ok: true };
    });
  });

  socket.on('player:submit_vote', (data = {}, reply) => {
    handlePlayerAction(socket, reply, () => {
      submitVote(state, {
        voterId: socket.data.playerId,
        targetIds: data.targetIds,
        now: Date.now(),
      });
      persistState();
      if (allVotesSubmitted(state)) {
        finishVotePhase();
      } else {
        broadcastState();
      }
      return { ok: true };
    });
  });

  socket.on('disconnect', () => {
    if (socket.data.playerId) {
      markDisconnected(state, { playerId: socket.data.playerId });
      persistAndBroadcast();
    }
  });
});

function finishDescriptionPhase() {
  if (state.phase !== 'description') return null;
  clearActiveTimer();
  const summary = endDescriptionPhase(state, { now: Date.now() });
  persistState();
  io.emit('round:description_summary', summary);
  broadcastState();
  return summary;
}

function finishVotePhase() {
  if (state.phase !== 'voting') return null;
  clearActiveTimer();
  const result = endVotePhase(state, { now: Date.now() });
  persistState();
  io.emit('round:result', result);
  broadcastState();
  return result;
}

function emitDescriptionOpened() {
  for (const client of io.sockets.sockets.values()) {
    if (!client.data.playerId) continue;
    client.emit('round:description_opened', getPlayerRoundState(state, client.data.playerId));
  }
}

function openVoteForAll() {
  const payload = openVote(state, { now: Date.now() });
  persistState();
  io.emit('round:vote_opened', payload);
  startPhaseTimer('voting', VOTE_SECONDS, finishVotePhase);
  broadcastState();
  return payload;
}

function broadcastState() {
  io.emit('room:state', getPublicRoomState());
  for (const client of io.sockets.sockets.values()) {
    if (client.data.isAdmin) {
      client.emit('admin:state', getAdminState(state));
    }
    if (client.data.playerId && state.players[client.data.playerId]) {
      client.emit('player:state', getPlayerRoundState(state, client.data.playerId));
    }
  }
}

function clearPlayerSocket(playerId, message) {
  for (const client of io.sockets.sockets.values()) {
    if (client.data.playerId !== playerId) continue;
    client.data.playerId = null;
    client.data.playerToken = null;
    client.emit('player:kicked', { message });
  }
}

function clearPlayerSockets(message) {
  for (const client of io.sockets.sockets.values()) {
    if (!client.data.playerId) continue;
    client.data.playerId = null;
    client.data.playerToken = null;
    client.emit('player:kicked', { message });
  }
}

function persistAndBroadcast() {
  persistState();
  broadcastState();
}

function persistState() {
  saveState(STATE_PATH, state);
}

function startPhaseTimer(phase, durationSeconds, onEnd) {
  clearActiveTimer();
  const endsAt = Date.now() + durationSeconds * 1000;

  const emitTick = () => {
    const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    io.emit('timer:tick', { phase, remaining, duration: durationSeconds });
  };

  activeTimer = {
    interval: setInterval(emitTick, 1000),
    timeout: setTimeout(() => {
      activeTimer = null;
      onEnd();
    }, durationSeconds * 1000),
  };
  emitTick();
}

function clearActiveTimer() {
  if (!activeTimer) return;
  clearInterval(activeTimer.interval);
  clearTimeout(activeTimer.timeout);
  activeTimer = null;
}

function handleAdminAction(socket, reply, action) {
  handleSocketAction(socket, reply, () => {
    if (!socket.data.isAdmin) {
      throw new Error('Bạn cần đăng nhập quản trò trước.');
    }
    return action();
  });
}

function handlePlayerAction(socket, reply, action) {
  handleSocketAction(socket, reply, () => {
    if (!socket.data.playerId || !state.players[socket.data.playerId]) {
      throw new Error('Bạn cần tham gia game trước.');
    }
    return action();
  });
}

function handleSocketAction(socket, reply, action) {
  try {
    const result = action();
    if (typeof reply === 'function') reply(result);
  } catch (error) {
    const payload = { ok: false, message: error.message };
    socket.emit('error:message', payload);
    if (typeof reply === 'function') reply(payload);
  }
}

function getPublicRoomState() {
  const currentRound = state.currentRound
    ? {
        number: state.currentRound.number,
        spyCount: state.currentRound.spyCount,
        descriptions:
          ['summary', 'voting', 'result', 'gameOver'].includes(state.phase) && state.currentRound
            ? getDescriptionSummary(state).descriptions
            : [],
        votesSubmitted: state.currentRound ? Object.keys(state.currentRound.votes).length : 0,
        result: state.phase === 'result' || state.phase === 'gameOver' ? state.currentRound.result : null,
      }
    : null;

  return {
    roomCode: state.roomCode,
    phase: state.phase,
    lobbyLocked: state.lobbyLocked,
    roundNumber: state.roundNumber,
    spyPoolRemaining: state.spyPool.length,
    playerCount: state.joinOrder.filter((id) => state.players[id]).length,
    players: state.joinOrder
      .filter((id) => state.players[id])
      .map((id) => ({
        id,
        name: state.players[id].name,
        score: state.players[id].score,
        connected: state.players[id].connected,
      })),
    currentRound,
    leaderboard: getLeaderboard(state),
    podium: state.podium,
  };
}

function generateRoomCode() {
  return `SPY-${Math.floor(1000 + Math.random() * 9000)}`;
}

function getLanUrls() {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${PORT}`);
      }
    }
  }
  return urls;
}

server.listen(PORT, () => {
  const localUrl = `http://localhost:${PORT}`;
  console.log(`Game Truy Tìm Gián Điệp đang chạy tại ${localUrl}`);
  console.log(`Admin: ${localUrl}/admin`);
  for (const url of getLanUrls()) {
    console.log(`LAN: ${url}  |  Admin: ${url}/admin`);
  }
});
