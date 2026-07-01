import { useEffect, useState } from "react";
import apiService from "../services/api";

export const ServiceRequestPage = () => {
  const [requests, setRequests] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All Services");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const loadData = async () => {
      const result = await apiService.fetchRequests({
        category: selectedCategory,
        search: searchTerm,
      });

      setRequests(result.data);
    };

    loadData();
  }, [selectedCategory, searchTerm]);

  return (
    <div>
      {/* your UI here */}
    </div>
  );
};