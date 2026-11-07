const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const rooms = new Map();

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'gem-battle.html' : req.url);
  const ext = path.extname(filePath);
  const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  let roomId = null;
  let playerRole = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'CREATE_ROOM') {
        roomId = msg.roomId;
        playerRole = 'host';
        ws.roomId = roomId;
        ws.playerRole = playerRole;
        
        if (!rooms.has(roomId)) {
          rooms.set(roomId, { host: ws, guest: null });
          console.log('Room created:', roomId, 'Total rooms:', rooms.size);
        }
        ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomId }));
      }
      
      else if (msg.type === 'JOIN_ROOM') {
        roomId = msg.roomId.toUpperCase();
        playerRole = 'guest';
        ws.roomId = roomId;
        ws.playerRole = playerRole;
        
        const room = rooms.get(roomId);
        console.log('JOIN_ROOM:', roomId, 'Room exists:', !!room, 'Guest exists:', room?.guest);
        if (room && !room.guest) {
          room.guest = ws;
          ws.send(JSON.stringify({ type: 'JOINED', roomId }));
          if (room.host && room.host.readyState === 1) {
            room.host.send(JSON.stringify({ type: 'PEER_JOINED' }));
          }
          console.log('Guest joined:', roomId);
        } else {
          ws.send(JSON.stringify({ type: 'ERROR', message: room ? 'Room is full' : 'Room not found' }));
          console.log('Join failed:', roomId, room);
        }
      }
      
      else if (msg.type === 'GAME_MESSAGE') {
        const room = rooms.get(roomId);
        if (room) {
          const target = playerRole === 'host' ? room.guest : room.host;
          if (target && target.readyState === 1) {
            target.send(JSON.stringify({ type: 'GAME_MESSAGE', data: msg.data }));
          }
        }
      }
      
      else if (msg.type === 'LEAVE') {
        const room = rooms.get(roomId);
        if (room) {
          if (playerRole === 'host' && room.guest) {
            room.guest.send(JSON.stringify({ type: 'PEER_LEFT' }));
          } else if (room.host) {
            room.host.send(JSON.stringify({ type: 'PEER_LEFT' }));
          }
          rooms.delete(roomId);
        }
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    console.log('WS closed:', roomId, playerRole);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        if (playerRole === 'host' && room.guest) {
          room.guest.send(JSON.stringify({ type: 'PEER_LEFT' }));
        } else if (room.host) {
          room.host.send(JSON.stringify({ type: 'PEER_LEFT' }));
        }
        rooms.delete(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`WS: ws://localhost:${PORT}`);
});
