let socketServer = null;

function setSocketServer(io) {
  socketServer = io || null;
}

function getSocketServer() {
  return socketServer;
}

function emitSlaUpdated(payload) {
  try {
    if (!socketServer) return false;
    socketServer.emit("sla_updated", payload);
    return true;
  } catch (error) {
    console.warn("SLA socket emit failed:", error.message);
    return false;
  }
}

module.exports = { setSocketServer, getSocketServer, emitSlaUpdated };
