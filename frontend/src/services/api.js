const API_BASE_URL = 'http://localhost:5000/api'; // Points straight to your Express backend port

export const apiService = {
  // Get all tracking assets
  async fetchAssets() {
    try {
      const response = await fetch(`${API_BASE_URL}/assets`);
      if (!response.ok) throw new Error('Network response failure fetching assets');
      return await response.json();
    } catch (error) {
      console.error("API Service Error [fetchAssets]:", error);
      throw error;
    }
  },

  // Get active system tickets
  async fetchTickets() {
    try {
      const response = await fetch(`${API_BASE_URL}/tickets`);
      if (!response.ok) throw new Error('Network response failure fetching tickets');
      return await response.json();
    } catch (error) {
      console.error("API Service Error [fetchTickets]:", error);
      throw error;
    }
  }
};