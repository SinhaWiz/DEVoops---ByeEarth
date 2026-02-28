'use client';

import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import toast, { Toaster } from 'react-hot-toast';
import Link from 'next/link';

interface StockItem {
  id: string;
  name: string;
  quantity: number;
}

interface Order {
  orderId: string;
  itemId: string;
  itemName: string;
  status: 'pending' | 'in_kitchen' | 'stock_verified' | 'ready' | 'rejected';
  timestamp: string;
}

const MENU_ITEMS = [
  { id: 'spaghetti', emoji: '🍝', price: '$8.50' },
  { id: 'ramen', emoji: '🍜', price: '$12.00' },
  { id: 'pizza', emoji: '🍕', price: '$10.00' },
];

const STATUS_STAGES = ['pending', 'in_kitchen', 'stock_verified', 'ready'] as const;
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_kitchen: 'In Kitchen',
  stock_verified: 'Stock Verified',
  ready: 'Ready',
  rejected: 'Rejected',
};

// Socket.io connects directly from browser to notification-hub (WebSocket can't use Next.js rewrites)
const NOTIFICATION_URL = 'http://localhost:3005';

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [username, setUsername] = useState('student1');
  const [password, setPassword] = useState('password123');
  const [stock, setStock] = useState<Record<string, StockItem>>({});
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch real stock quantities from stock-service via Next.js rewrite proxy
  const fetchStock = useCallback(async () => {
    try {
      const res = await fetch('/api/stock-service/stock');
      if (res.ok) {
        const items: StockItem[] = await res.json();
        const map: Record<string, StockItem> = {};
        for (const item of items) {
          map[item.id] = item;
        }
        setStock(map);
      }
    } catch (err) {
      console.error('Failed to fetch stock:', err);
    }
  }, []);

  // Socket.io connection for real-time order status updates
  useEffect(() => {
    if (token && userId) {
      const socket: Socket = io(NOTIFICATION_URL);

      socket.on('connect', () => {
        console.log('Connected to notification hub');
        socket.emit('join_user', userId);
      });

      socket.on('notification', (data: { orderId: string; type: string; status: string; message: string }) => {
        console.log('Notification received:', data);
        const { orderId, status, message } = data;

        // Update order status in tracker
        setOrders(prev => prev.map(o =>
          o.orderId === orderId ? { ...o, status: status as Order['status'] } : o
        ));

        // Show contextual toasts
        if (status === 'ready') {
          toast.success(message || 'Order is ready!', { duration: 5000 });
          fetchStock();
        } else if (status === 'rejected') {
          toast.error(message || 'Order was rejected', { duration: 5000 });
          fetchStock();
        } else if (status === 'in_kitchen') {
          toast(message || 'Order is being prepared...', { icon: '👨‍🍳', duration: 3000 });
        } else if (status === 'stock_verified') {
          toast(message || 'Stock verified', { icon: '✅', duration: 3000 });
        }
      });

      return () => {
        socket.disconnect();
      };
    }
  }, [token, userId, fetchStock]);

  // Initial stock fetch + polling every 10s
  useEffect(() => {
    fetchStock();
    const interval = setInterval(fetchStock, 10000);
    return () => clearInterval(interval);
  }, [fetchStock]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/identity-provider/login', {
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
    } catch {
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
    try {
      const res = await fetch('/api/order-gateway/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ itemId, quantity: 1 }),
      });
      const data = await res.json();

      if (res.status === 202) {
        const itemInfo = stock[itemId];
        setOrders(prev => [{
          orderId: data.orderId,
          itemId,
          itemName: itemInfo?.name || itemId,
          status: 'pending',
          timestamp: new Date().toISOString(),
        }, ...prev]);
        toast.success('Order placed!', { duration: 2000 });
      } else if (res.status === 422) {
        toast.error(`Out of stock: ${data.error}`);
      } else {
        toast.error(data.error || 'Order failed');
      }
    } catch {
      toast.error('Gateway unreachable');
    }
  };

  const getStageIndex = (status: string) => {
    if (status === 'rejected') return -1;
    return STATUS_STAGES.indexOf(status as typeof STATUS_STAGES[number]);
  };

  // Login screen
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

  // Main dashboard
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
            onClick={() => { setToken(null); setOrders([]); }}
            className="px-4 py-2 border rounded text-sm hover:bg-gray-100 dark:hover:bg-zinc-800 dark:text-gray-300 transition-all"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cafeteria Menu with real stock */}
        <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4 dark:text-white">Cafeteria Menu</h2>
          <div className="space-y-4">
            {MENU_ITEMS.map((item) => {
              const s = stock[item.id];
              const qty = s?.quantity ?? null;
              const outOfStock = qty !== null && qty <= 0;
              return (
                <div key={item.id} className={`flex items-center justify-between p-3 border rounded dark:border-zinc-800 ${outOfStock ? 'opacity-50' : ''}`}>
                  <div>
                    <p className="font-medium dark:text-white">{item.emoji} {s?.name || item.id}</p>
                    <div className="flex gap-3 items-center">
                      <p className="text-xs text-blue-500 font-bold">{item.price}</p>
                      <p className={`text-xs font-semibold ${outOfStock ? 'text-red-500' : 'text-green-600'}`}>
                        {qty !== null ? (outOfStock ? 'Out of Stock' : `${qty} left`) : 'Loading...'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => placeOrder(item.id)}
                    disabled={outOfStock}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Order
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Live Order Status Tracker */}
        <section className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm">
            <h2 className="text-lg font-semibold mb-4 dark:text-white">Live Order Tracker</h2>
            {orders.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">No orders placed yet. Place an order from the menu!</p>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {orders.map((order) => {
                  const stageIdx = getStageIndex(order.status);
                  const isRejected = order.status === 'rejected';
                  return (
                    <div key={order.orderId} className="p-3 border rounded dark:border-zinc-700">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-sm dark:text-white">{order.itemName}</p>
                          <p className="text-xs text-gray-400 font-mono">{order.orderId}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          order.status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                          isRejected ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                          'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                        }`}>
                          {STATUS_LABELS[order.status] || order.status}
                        </span>
                      </div>
                      {/* Status progression bar */}
                      {isRejected ? (
                        <div className="flex items-center gap-1 mt-2">
                          <span className="w-full h-1.5 rounded bg-red-500"></span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 mt-2">
                          {STATUS_STAGES.map((stage, i) => (
                            <div key={stage} className={`flex-1 h-1.5 rounded ${i <= stageIdx ? 'bg-green-500' : 'bg-gray-200 dark:bg-zinc-700'} transition-colors duration-500`} />
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between mt-1">
                        {isRejected ? (
                          <span className="text-[10px] text-red-500 font-semibold">Order Rejected</span>
                        ) : (
                          STATUS_STAGES.map((stage, i) => (
                            <span key={stage} className={`text-[10px] ${i <= stageIdx ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-gray-400 dark:text-zinc-600'}`}>
                              {STATUS_LABELS[stage]}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-slate-800 text-white p-6 rounded-xl shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Technical Summary</h2>
            <p className="text-xs text-gray-400 leading-relaxed italic">
              Orders are processed asynchronously. When you click &apos;Order&apos;, the Gateway checks Redis and enqueues to RabbitMQ.
              The Kitchen Worker processes it (3-7s delay), calls Stock Service (Postgres + Optimistic Locking),
              and notifies you at each stage via Socket.io. Watch the tracker above for
              real-time status: Pending → In Kitchen → Stock Verified → Ready.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
