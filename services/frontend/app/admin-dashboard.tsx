"use client";

import { useState, useEffect } from "react";
import toast, { Toaster } from "react-hot-toast";

export default function AdminDashboard() {
  const [health, setHealth] = useState<any>({});
  const [metrics, setMetrics] = useState<any>({});
  const [chaosStatus, setChaosStatus] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const SERVICES = [
    { name: "Order Gateway", url: "http://localhost:3002" },
    { name: "Stock Service", url: "http://localhost:3003" },
    { name: "Kitchen Queue", url: "http://localhost:3004" },
    { name: "Notification Hub", url: "http://localhost:3005" },
  ];

  useEffect(() => {
    fetchAllHealth();
    fetchAllMetrics();
    // Optionally poll every 30s
    const interval = setInterval(() => {
      fetchAllHealth();
      fetchAllMetrics();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchAllHealth = async () => {
    const results: any = {};
    for (const svc of SERVICES) {
      try {
        const res = await fetch(`${svc.url}/health`);
        results[svc.name] = await res.json();
      } catch {
        results[svc.name] = { status: "DOWN" };
      }
    }
    setHealth(results);
  };

  const fetchAllMetrics = async () => {
    const results: any = {};
    for (const svc of SERVICES) {
      try {
        const res = await fetch(`${svc.url}/metrics`);
        results[svc.name] = await res.text();
      } catch {
        results[svc.name] = "Unavailable";
      }
    }
    setMetrics(results);
  };

  const triggerChaos = async (svc: any) => {
    setLoading(true);
    try {
      const res = await fetch(`${svc.url}/chaos`, { method: "POST" });
      if (res.ok) {
        toast.success(`Chaos triggered on ${svc.name}`);
        setChaosStatus((prev: any) => ({ ...prev, [svc.name]: "ACTIVE" }));
      } else {
        toast.error(`Failed to trigger chaos on ${svc.name}`);
      }
    } catch {
      toast.error(`Failed to reach ${svc.name}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 p-4 sm:p-8">
      <Toaster position="top-right" />
      <header className="max-w-4xl mx-auto flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold dark:text-white">Admin Dashboard</h1>
      </header>
      <main className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Service Health</h2>
          <ul className="space-y-2">
            {SERVICES.map((svc) => (
              <li key={svc.name} className="flex items-center justify-between">
                <span className="font-medium dark:text-white">{svc.name}</span>
                <span className={
                  health[svc.name]?.status === "UP"
                    ? "text-green-600 font-bold"
                    : "text-red-600 font-bold"
                }>
                  {health[svc.name]?.status || "Unknown"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Chaos Controls</h2>
          <ul className="space-y-2">
            {SERVICES.map((svc) => (
              <li key={svc.name} className="flex items-center justify-between">
                <span className="font-medium dark:text-white">{svc.name}</span>
                <button
                  disabled={loading}
                  onClick={() => triggerChaos(svc)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm disabled:opacity-50"
                >
                  Trigger Chaos
                </button>
                <span className="ml-2 text-xs text-yellow-500">
                  {chaosStatus[svc.name] || "Idle"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="col-span-2 bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Metrics (Prometheus)</h2>
          <div className="overflow-x-auto text-xs">
            {SERVICES.map((svc) => (
              <div key={svc.name} className="mb-4">
                <div className="font-bold text-blue-600 dark:text-blue-400 mb-1">{svc.name}</div>
                <pre className="bg-gray-100 dark:bg-zinc-800 p-2 rounded whitespace-pre-wrap">
                  {metrics[svc.name] || "No metrics"}
                </pre>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
