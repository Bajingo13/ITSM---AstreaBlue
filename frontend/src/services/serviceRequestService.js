import apiService from "./api";

export const getRequests = (category, search) =>
  apiService.fetchRequests({ category, search });

export const getPopular = () => apiService.fetchPopularServices();

export const getRequestById = (id) => apiService.fetchRequestById(id);