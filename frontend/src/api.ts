/**
 * AMEN Dashboard - API Client
 * Handles all communication with the backend
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface DashboardStats {
  total_events: number;
  threats_detected: number;
  actions_taken: number;
  current_oracle_price: number;
  current_amm_price: number;
  price_deviation: number;
  amm_paused: boolean;
  vault_paused: boolean;
  liquidations_blocked: boolean;
  last_update: string;
}

export interface SecurityEvent {
  id: number;
  timestamp: string;
  block_number: number;
  event_type: string;
  oracle_price: number;
  amm_price: number;
  price_deviation: number;
  classification?: string;
  confidence?: number;
  explanation?: string;
  evidence?: string[];
  action?: string;
  action_reason?: string;
  execute_on_chain?: boolean;
  tx_hash?: string;
}

export interface PriceDataPoint {
  timestamp: string;
  oracle_price: number;
  amm_price: number;
  block_number: number;
}

export interface ThreatEntry {
  timestamp: string;
  classification: string;
  confidence: number;
  action?: string;
  tx_hash?: string;
  explanation?: string;
}

// Cache-busting helper
const noCacheUrl = (url: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_t=${Date.now()}`;
};

// Fetch dashboard stats
export async function fetchStats(): Promise<DashboardStats> {
  const response = await fetch(noCacheUrl(`${API_BASE}/api/stats`), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
}

// Fetch recent events
export async function fetchEvents(limit: number = 50): Promise<SecurityEvent[]> {
  const response = await fetch(noCacheUrl(`${API_BASE}/api/events?limit=${limit}`), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch events');
  return response.json();
}

// Fetch price history
export async function fetchPriceHistory(hours: number = 1): Promise<PriceDataPoint[]> {
  const response = await fetch(noCacheUrl(`${API_BASE}/api/prices?hours=${hours}`), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch prices');
  return response.json();
}

// Fetch threats
export async function fetchThreats(limit: number = 20): Promise<ThreatEntry[]> {
  const response = await fetch(noCacheUrl(`${API_BASE}/api/events/threats?limit=${limit}`), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch threats');
  return response.json();
}

// Fetch actions
export async function fetchActions(limit: number = 20): Promise<SecurityEvent[]> {
  const response = await fetch(noCacheUrl(`${API_BASE}/api/events/actions?limit=${limit}`), { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch actions');
  return response.json();
}

// Redeploy AMM (reset to $2000)
export async function redeployAMM(): Promise<{ success: boolean; message: string; tx_hash?: string; new_price?: number }> {
  const response = await fetch(`${API_BASE}/api/admin/redeploy-amm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) throw new Error('Failed to redeploy AMM');
  return response.json();
}

// Simulate attack
export async function simulateAttack(): Promise<{ success: boolean; message: string; blocked: boolean; tx_hash?: string; price_before?: number; price_after?: number }> {
  const response = await fetch(`${API_BASE}/api/admin/simulate-attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) throw new Error('Failed to simulate attack');
  return response.json();
}

export async function resetAMM(): Promise<{ success: boolean; message: string; new_price?: number; tx_hash?: string }> {
  const response = await fetch(`${API_BASE}/api/admin/reset-amm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) throw new Error('Failed to reset AMM');
  return response.json();
}

// WebSocket connection
export function createWebSocket(onMessage: (data: any) => void): WebSocket {
  // Use relative path for websocket (goes through vite proxy)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  
  ws.onmessage = (event) => {
    // Ignore pong responses (plain text, not JSON)
    if (event.data === 'pong') {
      return;
    }
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  };
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    // Start ping interval
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('ping');
      }
    }, 30000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected');
  };
  
  return ws;
}
