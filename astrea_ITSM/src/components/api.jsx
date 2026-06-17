// src/api.js
const API_URL = 'http://localhost:5000'; // Change this to your real URL

export async function getData(endpoint) {
  const response = await fetch(`${API_URL}${endpoint}`);
  return response.json();
}