const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const games = new Map(); // room code -> game

const newGame = () => ({ board: Array(9).fill(''), turn: 'X', starter: 'X', winner: null, line: null, rematch: { X: false, O: false }, players: { X: null, O: null } });

// Clear the board for a fresh game (used when a player leaves, so a new opponent never inherits a half-played board).
const resetBoard = g => Object.assign(g, { board: Array(9).fill(''), turn: 'X', starter: 'X', winner: null, line: null, rematch: { X: false, O: false } });

function result(b) {
  for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return { winner: b[a], line: [a, c, d] };
  return b.every(Boolean) ? { winner: 'draw', line: null } : { winner: null, line: null };
}

const publicState = g => ({
  board: g.board, turn: g.turn, winner: g.winner, line: g.line, rematch: g.rematch,
  seated: { X: !!g.players.X, O: !!g.players.O },
});

function leave(socket) {
  const code = socket.data.code;
  const g = games.get(code);
  if (!g) return;
  for (const m of ['X', 'O']) if (g.players[m] === socket.id) g.players[m] = null;
  socket.leave(code);
  socket.data.code = null;
  if (!g.players.X && !g.players.O) { games.delete(code); return; }
  resetBoard(g);
  io.to(code).emit('state', publicState(g));
}

io.on('connection', socket => {
  socket.on('join', raw => {
    const code = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    if (code.length < 3) return;
    leave(socket);
    const g = games.get(code) || newGame();
    games.set(code, g);
    const mark = !g.players.X ? 'X' : !g.players.O ? 'O' : null; // null = spectator
    if (mark) g.players[mark] = socket.id;
    socket.data.code = code;
    socket.join(code);
    socket.emit('joined', { code, mark });
    io.to(code).emit('state', publicState(g));
  });

  // The server is the referee: it checks every move.
  socket.on('move', i => {
    const g = games.get(socket.data.code);
    if (!g || g.winner || !Number.isInteger(i) || i < 0 || i > 8 || g.board[i]) return;
    if (g.players[g.turn] !== socket.id) return; // not your turn / not a player
    g.board[i] = g.turn;
    Object.assign(g, result(g.board));
    if (!g.winner) g.turn = g.turn === 'X' ? 'O' : 'X';
    io.to(socket.data.code).emit('state', publicState(g));
  });

  // Rematch needs both players to agree. The starting player alternates each game.
  socket.on('rematch', () => {
    const code = socket.data.code;
    const g = games.get(code);
    if (!g || !g.winner) return;
    const m = g.players.X === socket.id ? 'X' : g.players.O === socket.id ? 'O' : null;
    if (!m) return;
    g.rematch[m] = true;
    if (g.rematch.X && g.rematch.O) {
      g.starter = g.starter === 'X' ? 'O' : 'X';
      Object.assign(g, { board: Array(9).fill(''), turn: g.starter, winner: null, line: null, rematch: { X: false, O: false } });
    }
    io.to(code).emit('state', publicState(g));
  });

  socket.on('leave', () => leave(socket));

  socket.on('disconnect', () => leave(socket));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`Tic-tac-toe running on http://localhost:${PORT}`));
}

module.exports = server;