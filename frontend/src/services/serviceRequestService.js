import API from "./api";

export const getRequests = (category, search) =>
  API.get("/service-requests", {
    params: { category, search },
  });

export const getPopular = () =>
  API.get("/service-requests/popular");

export const getRequestById = (id) =>
  API.get(`/service-requests/${id}`);