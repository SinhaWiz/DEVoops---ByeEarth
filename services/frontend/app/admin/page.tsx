"use client";

import { useState, useEffect, useCallback } from "react";
import toast, { Toaster } from "react-hot-toast";
import Link from "next/link";

export default function AdminDashboard() {
  const [health, setHealth] = useState<Record<string, any>>({});
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [chaosStatus, setChaosStatus] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const SERVICES = [
    { name: "Identity Provider", url: "http://localhost:3001" },
    { name: "Order Gateway", url: "http://localhost:3002" },
    { name: "Stock Service", url: "http://localhost:3003" },
    { name: "Kitchen Queue", url: "http://localhost:3004" },
    { name: "Notification Hub", url: "http://localhost:3005" },
  ];

  const fetchAllHealth = useCallback(async () => {
    const results: Record<string, any> = {};
    await Promise.all(
      SERVICES.map(async (svc) => {
        try {
          const res = await fetch(`${svc.url}/health`, { cache: "no-store" });
          const data = await res.json();
          results[svc.name] = { ...data, httpStatus: res.status };
        } catch {
          results[svc.name] = { status: "DOWN", httpStatus: 0 };
        }
      })
    );
    setHealth(results);
  }, []);

  const fetchAllMetrics = useCallback(async () => {
    const results: Record<string, string> = {};
    await Promise.all(
      SERVICES.map(async (svc) => {
        try {
          const res = await fetch(`${svc.url}/metrics`, { cache: "no-store" });
          results[svc.name] = await res.text();
        } catch {
          results[svc.name] = "Unavailable";
        }
      })
    );
    setMetrics(results);
  }, []);

  const fetchAllChaosStatus = useCallback(async () => {
    const results: Record<string, string> = {};
    await Promise.all(
      SERVICES.map(async (svc) => {
        try {
          const res = await fetch(`${svc.url}/chaos`, { cache: "no-store" });
          const data = await res.json();
          results[svc.name] = data.chaosMode ? "ACTIVE" : "Idle";
        } catch {
          results[svc.name] = "Unknown";
        }
      })
    );
    setChaosStatus(results);
  }, []);

  useEffect(() => {
    fetchAllHealth();
    fetchAllMetrics();
    fetchAllChaosStatus();
    const interval = setInterval(() => {
      fetchAllHealth();
      fetchAllMetrics();
      fetchAllChaosStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchAllHealth, fetchAllMetrics, fetchAllChaosStatus]);

  const triggerChaos = async (svc: { name: string; url: string }, enable: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`${svc.url}/chaos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable }),
      });
      if (res.ok) {
        const action = enable ? "enabled" : "disabled";
        toast.success(`Chaos ${action} on ${svc.name}`);
        setChaosStatus((prev) => ({ ...prev, [svc.name]: enable ? "ACTIVE" : "Idle" }));
        // Refresh health after chaos toggle
        setTimeout(fetchAllHealth, 500);
      } else {
        toast.error(`Failed to toggle chaos on ${svc.name}`);
      }
    } catch {
      toast.error(`Failed to reach ${svc.name}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (svc: string) => {
    const h = health[svc];
    if (!h) return "bg-gray-400";
    if (h.httpStatus === 200 && h.status === "UP") return "bg-green-500";
    if (h.httpStatus === 503) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getStatusText = (svc: string) => {
    const h = health[svc];
    if (!h) return "Unknown";
    if (h.httpStatus === 503) return "DEGRADED (503)";
    return h.status || "Unknown";
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 p-4 sm:p-8">
      <Toaster position="top-right" />
      <header className="max-w-5xl mx-auto flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Admin Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Service Health &amp; Chaos Controls</p>
        </div>
        <Link
          href="/"
          className="px-4 py-2 border rounded text-sm hover:bg-gray-100 dark:hover:bg-zinc-800 dark:text-gray-300 transition-all"
        >
          ← Student View
        </Link>
      </header>

      <main className="max-w-5xl mx-auto space-y-6">
        {/* Service Health Grid */}
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Service Health Grid</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {SERVICES.map((svc) => (
              <div
                key={svc.name}
                className="p-4 border rounded-lg dark:border-zinc-700 flex flex-col items-center gap-2"
              >
                <div className={`w-4 h-4 rounded-full ${getStatusColor(svc.name)} ${health[svc.name]?.status === "UP" ? "animate-pulse" : ""}`} />
                <span className="font-medium text-sm dark:text-white text-center">{svc.name}</span>
                <span className={`text-xs font-bold ${
                  getStatusText(svc.name) === "UP" ? "text-green-600" :
                  getStatusText(svc.name).includes("503") ? "text-yellow-600" :
                  "text-red-600"
                }`}>
                  {getStatusText(svc.name)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Chaos Controls */}
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Chaos Controls</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Toggle chaos mode on a service to simulate failures. The service will return 503 on /health and reject requests.
          </p>
          <ul className="space-y-3">
            {SERVICES.map((svc) => (
              <li key={svc.name} className="flex items-center justify-between p-3 border rounded dark:border-zinc-700">
                <div className="flex items-center gap-3">
                  <span className="font-medium dark:text-white">{svc.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    chaosStatus[svc.name] === "ACTIVE"
                      ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                      : "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                  }`}>
                    {chaosStatus[svc.name] || "Idle"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={loading || chaosStatus[svc.name] === "ACTIVE"}
                    onClick={() => triggerChaos(svc, true)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm disabled:opacity-50 transition-colors"
                  >
                    Enable Chaos
                  </button>
                  <button
                    disabled={loading || chaosStatus[svc.name] !== "ACTIVE"}
                    onClick={() => triggerChaos(svc, false)}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm disabled:opacity-50 transition-colors"
                  >
                    Recover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Metrics */}
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Live Metrics (Prometheus)</h2>
          <div className="space-y-4">
            {SERVICES.map((svc) => (
              <details key={svc.name} className="group">
                <summary className="cursor-pointer font-bold text-blue-600 dark:text-blue-400 hover:underline">
                  {svc.name}
                </summary>
                <pre className="mt-2 bg-gray-100 dark:bg-zinc-800 p-3 rounded text-xs whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                  {metrics[svc.name] || "No metrics"}
                </pre>
              </details>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
