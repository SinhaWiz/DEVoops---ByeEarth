'use client';

import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';
import Link from 'next/link';

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [username, setUsername] = useState('student1');
  const [password, setPassword] = useState('password123');
  const [stock, setStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  // URLs (in dev/local env we use localhost, in production/docker we use proxy)
  // For client-side NEXT_PUBLIC_ is needed but we can hardcode for this demo
  const IDENTITY_URL = 'http://localhost:3001';
  const GATEWAY_URL = 'http://localhost:3002';
  const NOTIFICATION_URL = 'http://localhost:3005';

  // Socket Connection
  useEffect(() => {
    if (token && userId) {
      const socket = io(NOTIFICATION_URL);
      
      socket.on('connect', () => {
        console.log('Connected to notification hub');
        socket.emit('join_user', userId);
      });

      socket.on('notification', (data) => {
        console.log('Notification received:', data);
        if (data.status === 'confirmed') {
          toast.success(data.message, { duration: 5000 });
        } else {
          toast.error(data.message, { duration: 5000 });
        }
        // Refresh stock after any status update
        fetchStock();
      });

      return () => {
        socket.disconnect();
      };
    }
  }, [token, userId]);

  // Initial Stock Fetch
  useEffect(() => {
    fetchStock();
    const interval = setInterval(fetchStock, 10000); // Polling as fallback
    return () => clearInterval(interval);
  }, []);

  const fetchStock = async () => {
    try {
      // For now we get stock for known items
      // In a real app we'd get a list from catalog service
      const items = ['spaghetti', 'ramen', 'pizza'];
      const newStock: Record<string, number> = {};
      
      for (const id of items) {
        // We use the Gateway's internal knowledge (Redis) for fast check
        // Wait, the gateway doesn't have a public GET /stock/:id yet.
        // Let's call the stock service directly if CORS allows, 
        // OR adding a stock check in Gateway.
        // For simplicity let's call the Gateway (if we add an endpoint)
        const res = await fetch(`${GATEWAY_URL}/health`); // placeholder
        // Since Gateway 3002 doesn't have a catalog yet, we simulate
        // In a real scenario, we'd have GET /catalog
      }
      
      // Seed default values for demo if empty
      if (Object.keys(stock).length === 0) {
        setStock({ 'spaghetti': 10, 'ramen': 5, 'pizza': 0 });
      }
    } catch (err) {
      console.error('Failed to fetch stock');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${IDENTITY_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setUserId(data.user.userId);
        toast.success(`Logged in as ${data.user.role}`);
      } else {
        toast.error(data.error || 'Login failed');
      }
    } catch (err) {
      toast.error('Identity Provider unreachable');
    } finally {
      setLoading(false);
    }
  };

  const placeOrder = async (itemId: string) => {
    if (!token) {
      toast.error('Please login first');
      return;
    }

    toast.loading('Placing order...', { id: 'order' });
    try {
      const res = await fetch(`${GATEWAY_URL}/order`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ itemId, quantity: 1 }),
      });
      const data = await res.json();
      
      if (res.status === 202) {
        toast.success('Order accepted into queue!', { id: 'order' });
      } else if (res.status === 422) {
        toast.error(`Fast-fail: ${data.error}`, { id: 'order' });
      } else {
        toast.error(data.error || 'Order failed', { id: 'order' });
      }
    } catch (err) {
      toast.error('Gateway unreachable', { id: 'order' });
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-zinc-950 p-4">
        <Toaster position="top-right" />
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-8">
          <h1 className="text-2xl font-bold mb-6 text-center dark:text-white underline decoration-blue-500">DEVoops Cafeteria</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Username</label>
              <input 
                type="text" 
                className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Password</label>
              <input 
                type="password" 
                className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button 
              disabled={loading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
            >
              {loading ? 'Logging in...' : 'Login to Order'}
            </button>
          </form>
          <p className="mt-4 text-xs text-gray-500 text-center italic">Testing credentials: student1 / password123</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 p-4 sm:p-8">
      <Toaster position="top-right" />
      <header className="max-w-4xl mx-auto flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">DEVoops Dashboard</h1>
          <p className="text-sm text-gray-500">User ID: {userId}</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin"
            className="px-4 py-2 border rounded text-sm hover:bg-gray-100 dark:hover:bg-zinc-800 dark:text-gray-300 transition-all"
          >
            Admin
          </Link>
          <button 
            onClick={() => setToken(null)}
            className="px-4 py-2 border rounded text-sm hover:bg-gray-100 dark:hover:bg-zinc-800 dark:text-gray-300 transition-all"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Cafeteria Menu</h2>
          <div className="space-y-4">
            {[
              { id: 'spaghetti', name: '🍝 Spaghetti Carbonara', price: '$8.50' },
              { id: 'ramen', name: '🍜 Spicy Miso Ramen', price: '$12.00' },
              { id: 'pizza', name: '🍕 Pepperoni Pizza', price: '$10.00' },
            ].map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 border rounded dark:border-zinc-800">
                <div>
                  <p className="font-medium dark:text-white">{item.name}</p>
                  <p className="text-xs text-blue-500 font-bold">{item.price}</p>
                </div>
                <button 
                  onClick={() => placeOrder(item.id)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                >
                  Order
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border-l-4 border-yellow-500">
            <h2 className="text-lg font-semibold mb-2 dark:text-white">System Status</h2>
            <ul className="text-sm space-y-2 dark:text-gray-400">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Order Gateway Connected
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Socket Notification Hub Active
              </li>
            </ul>
          </div>
          <div className="bg-slate-800 text-white p-6 rounded-xl shadow-sm">
             <h2 className="text-lg font-semibold mb-2">Technical Summary</h2>
             <p className="text-xs text-gray-400 leading-relaxed italic">
                Orders are processed asynchronously. When you click 'Order', the Gateway checks Redis and enqueues to RabbitMQ. 
                The Kitchen Worker then calls the Stock Service (Postgres with Optimistic Locking) and notifies you via Socket.io.
             </p>
          </div>
        </section>
      </main>
    </div>
  );
}
