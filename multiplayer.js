/**
 * multiplayer.js — Gem Battle
 * WebSocket клиент
 */
class Multiplayer {
  constructor(){
    this.ws        = null;
    this.roomId    = null;
    this.playerRole = null;
    this.onMessage    = null;
    this.onPeerJoined = null;
    this.onPeerLeft   = null;
  }

  createRoom(){
    this.roomId     = this._genId();
    this.playerRole = 'host';
    this._connect();
    return this.roomId;
  }

  joinRoom(roomId){
    this.roomId     = roomId.trim().toUpperCase();
    this.playerRole = 'guest';
    this._connect();
  }

  send(type, data = {}){
    if(!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'GAME_MESSAGE', data: { type, data } }));
  }

  close(){
    if(this.ws && this.ws.readyState === 1){
      this.ws.send(JSON.stringify({ type: 'LEAVE' }));
      this.ws.close();
    }
    this.ws = null;
    this.roomId = this.playerRole = null;
  }

  _genId(){
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({length:6}, ()=>c[Math.random()*c.length|0]).join('');
  }

  _connect(){
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}`);

    this.ws.onopen = () => {
      console.log('WS connected');
      if(this.playerRole === 'host'){
        this.ws.send(JSON.stringify({ type: 'CREATE_ROOM', roomId: this.roomId }));
      } else {
        this.ws.send(JSON.stringify({ type: 'JOIN_ROOM', roomId: this.roomId }));
      }
    };

    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this._recv(msg);
    };

    this.ws.onerror = (err) => {
      console.error('WS error:', err);
      alert('Ошибка соединения');
    };

    this.ws.onclose = () => {
      console.log('WS closed');
    };
  }

  _recv(msg){
    console.log('WS received:', msg);
    if(msg.type === 'ROOM_CREATED'){
      console.log('Room created');
    }
    else if(msg.type === 'JOINED'){
      console.log('Joined room as guest');
      if(this.onPeerJoined) this.onPeerJoined();
    }
    else if(msg.type === 'PEER_JOINED'){
      console.log('Peer joined!');
      if(this.onPeerJoined) this.onPeerJoined();
    }
    else if(msg.type === 'PEER_LEFT'){
      console.log('Peer left');
      if(this.onPeerLeft) this.onPeerLeft();
    }
    else if(msg.type === 'GAME_MESSAGE'){
      if(this.onMessage) this.onMessage(msg.data.type, msg.data.data);
    }
    else if(msg.type === 'ERROR'){
      alert(msg.message);
    }
  }
}

window.Multiplayer = Multiplayer;
