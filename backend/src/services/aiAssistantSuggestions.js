function normalizeRole(role) {
  return String(role || "").toLowerCase().replace(/[\s_-]+/g, "");
}

const COMMON_SUGGESTIONS = [
  "How many tickets are currently in progress?",
  "How many hardware assets can I access?",
  "How do I troubleshoot an offline endpoint?",
];

const ROLE_SUGGESTIONS = {
  superadmin: [
    "How many endpoints currently require attention?",
    "How many SLA tickets are breached?",
    "How many lifecycle cases still have pending tasks?",
  ],
  admin: [
    "How many endpoints in my branch require attention?",
    "How many SLA tickets are breached?",
    "How many replacement requests are active?",
  ],
  hr: [
    "How many onboarding and offboarding cases are active?",
    "How many lifecycle cases still have pending tasks?",
    "How many tickets are currently in progress?",
  ],
  technician: [
    "How many endpoints currently require attention?",
    "How many SLA tickets are due soon?",
    "How do I troubleshoot an offline endpoint?",
  ],
  employee: [
    "How many of my tickets are currently in progress?",
    "How many hardware assets can I access?",
    "How do I troubleshoot an offline endpoint?",
  ],
};

function getRoleAwareSuggestions(actor, limit = 6) {
  const role = normalizeRole(actor?.role_name);
  const combined = [...(ROLE_SUGGESTIONS[role] || []), ...COMMON_SUGGESTIONS];
  return [...new Set(combined)].slice(0, Math.min(Math.max(Number(limit) || 6, 1), 8));
}

module.exports = {
  getRoleAwareSuggestions,
  normalizeRole,
};
