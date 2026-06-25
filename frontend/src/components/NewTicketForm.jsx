import { API_URL } from "../config/api";
// frontend/src/components/NewTicketForm.jsx
import { useState } from 'react';

export default function NewTicketForm({ onTicketCreated }) {
  const [formData, setFormData] = useState({ title: '', description: '', raised_by: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const response = await fetch(`${API_URL}/api/v1/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    if (response.ok) {
      const newTicket = await response.json();
      onTicketCreated(newTicket); // This updates your dashboard list
      setFormData({ title: '', description: '', raised_by: '' });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 border rounded">
      <input placeholder="Title" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="border p-1 w-full" />
      <textarea placeholder="Description" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="border p-1 w-full mt-2" />
      <button type="submit" className="bg-blue-500 text-white p-2 mt-2">Submit Ticket</button>
    </form>
  );
}
