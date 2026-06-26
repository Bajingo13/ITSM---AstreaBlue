import { API_URL } from "../config/api";
export const getDashboardData = async () => {
  try {
    // Change the URL to include the full backend address
    const response = await fetch(`${API_URL}/api/health`); 
    
    if (!response.ok) throw new Error('Network response was not ok');
    
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch dashboard data", error);
    return { kpis: [], tickets: [], assets: [] };
  }
};
