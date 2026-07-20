import { io } from "socket.io-client";
import { API_URL } from "../config/api";

let socket = null;
let hasConnected = false;
const subscribers = new Set();
const replacementSubscribers = new Set();
const endpointSubscribers = new Set();

function ensureSocket() {
  if (socket) return socket;

  socket = io(API_URL, {
    transports: ["polling", "websocket"],
    withCredentials: true,
  });

  socket.on("ticket_changed", (event) => {
    subscribers.forEach((subscriber) => subscriber(event));
  });

  socket.on("replacement_changed", (event) => {
    replacementSubscribers.forEach((subscriber) => subscriber(event));
  });

  socket.on("endpoint_status_changed", (event) => {
    endpointSubscribers.forEach((subscriber) => subscriber(event));
  });

  socket.on("connect", () => {
    if (hasConnected) {
      subscribers.forEach((subscriber) => subscriber({ action: "reconnected" }));
      replacementSubscribers.forEach((subscriber) => subscriber({ action: "reconnected" }));
      endpointSubscribers.forEach((subscriber) => subscriber({ action: "reconnected" }));
    }
    hasConnected = true;
  });

  return socket;
}

export function subscribeToTicketChanges(subscriber) {
  subscribers.add(subscriber);
  ensureSocket();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && replacementSubscribers.size === 0 && endpointSubscribers.size === 0 && socket) {
      socket.disconnect();
      socket = null;
      hasConnected = false;
    }
  };
}

export function subscribeToReplacementChanges(subscriber) {
  replacementSubscribers.add(subscriber);
  ensureSocket();

  return () => {
    replacementSubscribers.delete(subscriber);
    if (subscribers.size === 0 && replacementSubscribers.size === 0 && endpointSubscribers.size === 0 && socket) {
      socket.disconnect();
      socket = null;
      hasConnected = false;
    }
  };
}

export function subscribeToEndpointStatusChanges(subscriber) {
  endpointSubscribers.add(subscriber);
  ensureSocket();

  return () => {
    endpointSubscribers.delete(subscriber);
    if (subscribers.size === 0 && replacementSubscribers.size === 0 && endpointSubscribers.size === 0 && socket) {
      socket.disconnect();
      socket = null;
      hasConnected = false;
    }
  };
}
