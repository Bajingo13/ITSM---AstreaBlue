process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  emitTicketChanged,
  emitEndpointStatusChanged,
  setSocketServer,
} = require("../src/services/socketService");

test.afterEach(() => setSocketServer(null));

test("ticket changes broadcast a privacy-safe dashboard invalidation event", () => {
  const emitted = [];
  setSocketServer({
    emit(eventName, payload) {
      emitted.push({ eventName, payload });
    },
  });

  const result = emitTicketChanged({
    action: "updated",
    ticket_id: 46,
    requester_id: 9,
    title: "Must not be broadcast",
  });

  assert.equal(result, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, "ticket_changed");
  assert.equal(emitted[0].payload.action, "updated");
  assert.match(emitted[0].payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal("ticket_id" in emitted[0].payload, false);
  assert.equal("requester_id" in emitted[0].payload, false);
  assert.equal("title" in emitted[0].payload, false);
});

test("endpoint changes broadcast only a privacy-safe invalidation", () => {
  const emitted = [];
  setSocketServer({
    emit(eventName, payload) {
      emitted.push({ eventName, payload });
    },
  });

  const result = emitEndpointStatusChanged({
    action: "online",
    device_id: 7,
    hostname: "PRIVATE-LAPTOP",
    branch_id: 1,
  });

  assert.equal(result, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].eventName, "endpoint_status_changed");
  assert.equal(emitted[0].payload.action, "online");
  assert.match(emitted[0].payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal("device_id" in emitted[0].payload, false);
  assert.equal("hostname" in emitted[0].payload, false);
  assert.equal("branch_id" in emitted[0].payload, false);
});
