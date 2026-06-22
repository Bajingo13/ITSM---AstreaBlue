import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Monitor,
  Lock,
  Globe,
  Wrench,
  ShoppingBag,
  Search,
  Star,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const serviceCategoryIcons = {
  Hardware: Box,
  Software: Monitor,
  "Access & Permissions": Lock,
  "Network Services": Globe,
  "IT Support": Wrench,
  Procurement: ShoppingBag,
};

const categoryDescriptions = {
  Hardware: "Request devices, repairs, and upgrades.",
  Software: "Request licenses, installs, and software updates.",
  "Access & Permissions": "Request account access, role changes, and permissions.",
  "Network Services": "Request network connectivity, VPN, or firewall access.",
  "IT Support": "Request help for service desk issues and troubleshooting.",
  Procurement: "Request procurement, replacement, and purchase approvals.",
};

function getCategoryIcon(name) {
  return serviceCategoryIcons[name] || Box;
}

export default function ServiceCatalog() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Services");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [ticketsRes, categoriesRes] = await Promise.all([
          fetch("http://localhost:5001/api/v1/tickets"),
          fetch("http://localhost:5001/api/v1/ticket-categories"),
        ]);

        const [ticketsData, categoriesData] = await Promise.all([
          ticketsRes.json(),
          categoriesRes.json(),
        ]);

        setTickets(Array.isArray(ticketsData) ? ticketsData : []);
        setCategories(Array.isArray(categoriesData) ? categoriesData : []);
      } catch (err) {
        console.error("Service catalog load failed:", err);
        setError("Unable to load service requests right now.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const serviceCounts = useMemo(() => {
    const ticketCounts = tickets.reduce((counts, ticket) => {
      const key = ticket.category || "Uncategorized";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});

    const categoryList = categories.map((category) => ({
      id: category.category_id,
      name: category.category_name,
      count: ticketCounts[category.category_name] || 0,
    }));

    const remainingNames = Object.keys(ticketCounts).filter(
      (categoryName) => !categoryList.some((item) => item.name === categoryName)
    );

    const additionalCategories = remainingNames.map((name) => ({
      id: null,
      name,
      count: ticketCounts[name],
    }));

    return [
      { id: null, name: "All Services", count: tickets.length },
      ...categoryList,
      ...additionalCategories,
    ];
  }, [categories, tickets]);

  const popularServices = useMemo(() => {
    return serviceCounts
      .slice(1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [serviceCounts]);

  const filteredRequests = useMemo(() => {
    const text = query.toLowerCase();

    return tickets.filter((ticket) => {
      const categoryMatch =
        selectedCategory === "All Services" ||
        ticket.category === selectedCategory;

      const searchMatch =
        ticket.title?.toLowerCase().includes(text) ||
        ticket.category?.toLowerCase().includes(text) ||
        ticket.requester_name?.toLowerCase().includes(text) ||
        ticket.ticket_number?.toLowerCase().includes(text) ||
        ticket.description?.toLowerCase().includes(text) ||
        ticket.status?.toLowerCase().includes(text);

      return categoryMatch && searchMatch;
    });
  }, [tickets, query, selectedCategory]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-7 shadow-xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900">Service Request Management</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Review and manage service requests submitted by users across hardware,
              software, access, network, and IT support.
            </p>
          </div>
          <div className="flex-1">
            <label className="relative block w-full rounded-3xl border border-slate-200 bg-slate-50 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search services, requests, users..."
                className="w-full rounded-3xl border-none bg-transparent py-4 pl-12 pr-4 text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {serviceCounts.map((service) => {
            const Icon = getCategoryIcon(service.name);
            const active = selectedCategory === service.name;

            return (
              <button
                key={`${service.name}-${service.id}`}
                type="button"
                onClick={() => setSelectedCategory(service.name)}
                className={`group overflow-hidden rounded-3xl border p-5 text-left transition ${
                  active
                    ? "border-blue-400 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50"
                }`}
              >
                <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-blue-700 transition group-hover:bg-blue-100">
                  <Icon size={24} />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">{service.name}</h2>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                  {service.count} request{service.count === 1 ? "" : "s"}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">Popular Services</h2>
            <p className="mt-2 text-sm text-slate-500">
              The most requested service categories from users.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600">
            Total requests: {tickets.length}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {popularServices.map((service) => {
            const Icon = getCategoryIcon(service.name);
            return (
              <div
                key={service.name}
                className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-3xl bg-white p-3 text-blue-700 shadow-sm">
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="font-black text-slate-900">{service.name}</p>
                    <p className="text-sm text-slate-500">{service.count} requests</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  {categoryDescriptions[service.name] ||
                    "Review and manage the fastest growing service requests."}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">User Requests</h2>
            <p className="mt-2 text-sm text-slate-500">
              Browse user service requests across categories and requesters.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
            <Star size={16} className="text-amber-500" />
            Showing {filteredRequests.length} request{filteredRequests.length === 1 ? "" : "s"}
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
            Loading service requests...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
            {error}
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-10 text-center text-slate-500">
            No requests found. Try another search term or select a different category.
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-100 text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Ticket</th>
                    <th className="px-6 py-4 font-semibold">Service</th>
                    <th className="px-6 py-4 font-semibold">Requester</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold">Created</th>
                    <th className="px-6 py-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {filteredRequests.map((ticket) => (
                    <tr key={ticket.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">{ticket.ticket_number}</p>
                        <p className="mt-1 text-sm text-slate-500">{ticket.title}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          {ticket.category || "Uncategorized"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-700">{ticket.requester_name || "Unknown"}</td>
                      <td className="px-6 py-4 text-slate-700">{ticket.status}</td>
                      <td className="px-6 py-4 text-slate-700">
                        {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : "-"}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
                        >
                          View <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
