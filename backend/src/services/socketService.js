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

function emitTicketChanged(payload) {
  try {
    if (!socketServer) return false;
    socketServer.emit("ticket_changed", {
      action: payload?.action || "changed",
      timestamp: payload?.timestamp || new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.warn("Ticket socket emit failed:", error.message);
    return false;
  }
}

function emitReplacementChanged(payload) {
  try {
    if (!socketServer) return false;
    socketServer.emit("replacement_changed", {
      action: payload?.action || "changed",
      requestId: payload?.requestId || null,
      timestamp: payload?.timestamp || new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.warn("Replacement socket emit failed:", error.message);
    return false;
  }
}

function emitEndpointStatusChanged(payload) {
  try {
    if (!socketServer) return false;
    // Broadcast only a privacy-safe invalidation. Each client must refetch the
    // authenticated, RBAC-filtered endpoint data it is permitted to see.
    socketServer.emit("endpoint_status_changed", {
      action: payload?.action === "online" ? "online" : "changed",
      timestamp: payload?.timestamp || new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.warn("Endpoint status socket emit failed:", error.message);
    return false;
  }
}

module.exports = {
  setSocketServer,
  getSocketServer,
  emitSlaUpdated,
  emitTicketChanged,
  emitReplacementChanged,
  emitEndpointStatusChanged,
};
