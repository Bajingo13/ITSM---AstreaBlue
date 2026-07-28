let dialogHandler = null;
const pendingRequests = [];

function dispatchRequest(request) {
  if (dialogHandler) {
    dialogHandler(request);
    return;
  }
  pendingRequests.push(request);
}

export function registerAppDialogHandler(handler) {
  dialogHandler = handler;
  while (dialogHandler && pendingRequests.length) {
    dialogHandler(pendingRequests.shift());
  }

  return () => {
    if (dialogHandler === handler) dialogHandler = null;
  };
}

function requestDialog(options) {
  return new Promise((resolve) => {
    dispatchRequest({
      ...options,
      resolve,
    });
  });
}

function normalizeOptions(messageOrOptions, defaults) {
  if (typeof messageOrOptions === "string") {
    return { ...defaults, message: messageOrOptions };
  }
  return { ...defaults, ...(messageOrOptions || {}) };
}

export function appConfirm(messageOrOptions) {
  return requestDialog(normalizeOptions(messageOrOptions, {
    type: "confirm",
    title: "Confirm action",
    confirmLabel: "Continue",
    cancelLabel: "Cancel",
    tone: "primary",
  }));
}

export function appAlert(messageOrOptions) {
  return requestDialog(normalizeOptions(messageOrOptions, {
    type: "alert",
    title: "AstreaBlue notification",
    confirmLabel: "Got it",
    tone: "info",
  }));
}

export function appPrompt(messageOrOptions) {
  return requestDialog(normalizeOptions(messageOrOptions, {
    type: "prompt",
    title: "Enter details",
    confirmLabel: "Submit",
    cancelLabel: "Cancel",
    tone: "primary",
    defaultValue: "",
  }));
}
