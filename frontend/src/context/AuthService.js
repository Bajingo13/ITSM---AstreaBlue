const API_URL = "http://localhost:5000/api/auth";

export async function loginUser(email, password) {
  const response = await fetch(`${API_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Login failed");
  }

  return data;
}

export function saveUser(user, rememberMe) {
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem("user", JSON.stringify(user));
}

export function getSavedUser() {
  const localUser = localStorage.getItem("user");
  const sessionUser = sessionStorage.getItem("user");

  return localUser
    ? JSON.parse(localUser)
    : sessionUser
    ? JSON.parse(sessionUser)
    : null;
}

export function logoutUser() {
  localStorage.removeItem("user");
  sessionStorage.removeItem("user");
}