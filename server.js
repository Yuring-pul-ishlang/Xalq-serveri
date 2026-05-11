const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const nodes = new Map();
const stats = { totalConnections: 0, totalChunks: 0, startTime: Date.now() };
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ name: 'Xalq Serveri', status: 'online', nodes: nodes.size }));
});
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws, req) => {
  const nodeId = 'XS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  nodes.set(nodeId, { ws, connectedAt: Date.now() });
  stats.totalConnections++;
  ws.send(JSON.stringify({ type: 'welcome', nodeId, totalNodes: nodes.size }));
  broadcast({ type: 'node_joined', nodeId, totalNodes: nodes.size }, nodeId);
  const peers = [];
  nodes.forEach((n, id) => { if (id !== nodeId) peers.push({ id }); });
  ws.send(JSON.stringify({ type: 'peer_list', peers }));
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'signal' && msg.to && nodes.has(msg.to)) {
        nodes.get(msg.to).ws.send(JSON.stringify({ type: 'signal', from: nodeId, signal: msg.signal }));
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
      } else if (msg.type === 'chunk_stored') {
        stats.totalChunks++;
        broadcast({ type: 'chunk_confirmed', nodeId, chunkId: msg.chunkId }, nodeId);
      }
    } catch(e) {}
  });
  ws.on('close', () => {
    nodes.delete(nodeId);
    broadcast({ type: 'node_left', nodeId, totalNodes: nodes.size });
  });
  ws.on('error', () => nodes.delete(nodeId));
});
function broadcast(data, except) {
  nodes.forEach((n, id) => {
    if (id !== except && n.ws.readyState === WebSocket.OPEN)
      n.ws.send(JSON.stringify(data));
  });
}
server.listen(PORT, () => console.log('Xalq Serveri port:' + PORT));
