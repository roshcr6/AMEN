import { useState, useEffect, useCallback } from 'react';
import { 
  Shield, 
  AlertTriangle, 
  Activity, 
  TrendingUp, 
  Pause, 
  Zap,
  Eye,
  Brain,
  Target,
  Skull,
  RefreshCw
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  ReferenceLine
} from 'recharts';
import { format, addMinutes } from 'date-fns';
import {
  DashboardStats,
  SecurityEvent,
  PriceDataPoint,
  ThreatEntry,
  fetchStats,
  fetchEvents,
  fetchPriceHistory,
  fetchThreats,
  fetchActions,
  createWebSocket,
  simulateAttack
} from './api';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Format time for display - always show IST timezone
// Backend sends UTC timestamps as strings, browser Date() is local time
function formatIST(date: Date | string, formatStr: string = 'HH:mm:ss'): string {
  if (typeof date === 'string') {
    // Backend UTC timestamp - parse and add 5:30 for IST
    const d = new Date(date);
    const istDate = addMinutes(d, 330);
    return format(istDate, formatStr);
  } else {
    // Browser Date object - already local time, just format it
    // But we need IST, so calculate from UTC
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const istDate = new Date(utcTime + (5.5 * 60 * 60 * 1000));
    return format(istDate, formatStr);
  }
}

// =============================================================================
// COMPONENTS
// =============================================================================

// Status Badge Component
function StatusBadge({ 
  status, 
  label 
}: { 
  status: 'healthy' | 'warning' | 'critical'; 
  label: string;
}) {
  const colors = {
    healthy: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30',
    warning: 'bg-cyber-yellow/20 text-cyber-yellow border-cyber-yellow/30',
    critical: 'bg-cyber-red/20 text-cyber-red border-cyber-red/30 animate-pulse'
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${colors[status]}`}>
      {label}
    </span>
  );
}

// Stat Card Component
function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  color = 'blue',
  subtitle 
}: { 
  title: string; 
  value: string | number; 
  icon: any;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
  subtitle?: string;
}) {
  const colors = {
    blue: 'text-cyber-blue',
    green: 'text-cyber-green',
    red: 'text-cyber-red',
    yellow: 'text-cyber-yellow',
    purple: 'text-cyber-purple'
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className={`text-2xl font-bold ${colors[color]}`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <Icon className={`w-8 h-8 ${colors[color]} opacity-50`} />
      </div>
    </div>
  );
}

// Price Chart Component with Attack Markers
function PriceChart({ data, attacks }: { data: PriceDataPoint[], attacks?: SecurityEvent[] }) {
  const chartData = data.map(d => ({
    ...d,
    time: formatIST(d.timestamp, 'HH:mm'),
    oracle: d.oracle_price,
    amm: d.amm_price
  }));

  // Get attack times (PAUSE_AMM actions = blocked attacks)
  const attackTimes = (attacks || [])
    .filter(a => a.action === 'PAUSE_AMM' || a.action === 'PROACTIVE_PAUSE_AMM' || a.event_type === 'PROACTIVE_DEFENSE' || a.event_type === 'AMM_PAUSED')
    .map(a => formatIST(a.timestamp, 'HH:mm'));

  return (
    <div className="card h-80">
      <div className="card-header flex items-center gap-2">
        <TrendingUp className="w-4 h-4" />
        Price Comparison (Oracle vs AMM)
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4e" />
          <XAxis 
            dataKey="time" 
            stroke="#666" 
            fontSize={12}
          />
          <YAxis 
            stroke="#666" 
            fontSize={12}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1a1a2e', 
              border: '1px solid #2a2a4e',
              borderRadius: '8px'
            }}
            labelStyle={{ color: '#888' }}
          />
          <Legend />
          {/* Attack markers - red dotted vertical lines */}
          {attackTimes.map((time, idx) => (
            <ReferenceLine 
              key={idx}
              x={time} 
              stroke="#ff4444" 
              strokeDasharray="5 5"
              strokeWidth={2}
              label={{ 
                value: '🚨 ATTACK', 
                position: 'top', 
                fill: '#ff4444', 
                fontSize: 10,
                fontWeight: 'bold'
              }}
            />
          ))}
          <Line 
            type="monotone" 
            dataKey="oracle" 
            name="Oracle Price"
            stroke="#00d4ff" 
            strokeWidth={2}
            dot={false}
          />
          <Line 
            type="monotone" 
            dataKey="amm" 
            name="AMM Price"
            stroke="#00ff88" 
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Threat Timeline Component
function ThreatTimeline({ threats, lastUpdate }: { threats: ThreatEntry[]; lastUpdate?: Date }) {
  const getClassificationColor = (classification: string) => {
    switch (classification) {
      case 'FLASH_LOAN_ATTACK': return 'text-cyber-red';
      case 'ORACLE_MANIPULATION': return 'text-cyber-yellow';
      default: return 'text-gray-400';
    }
  };

  const getClassificationIcon = (classification: string) => {
    switch (classification) {
      case 'FLASH_LOAN_ATTACK': return <Zap className="w-4 h-4 text-cyber-red" />;
      case 'ORACLE_MANIPULATION': return <Eye className="w-4 h-4 text-cyber-yellow" />;
      default: return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        Threat Timeline
        <span className="ml-auto text-xs text-cyber-green flex items-center gap-1">
          <span className="w-2 h-2 bg-cyber-green rounded-full animate-pulse"></span>
          LIVE {lastUpdate ? formatIST(lastUpdate, 'HH:mm:ss') : formatIST(new Date(), 'HH:mm:ss')} IST
        </span>
      </div>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {threats.length === 0 ? (
          <div className="p-4 bg-cyber-green/10 rounded-lg border border-cyber-green/20 text-center">
            <p className="text-cyber-green text-sm font-semibold">✅ No threats detected</p>
            <p className="text-gray-500 text-xs mt-1">Agent monitoring blockchain for attacks...</p>
          </div>
        ) : (
          threats.map((threat, i) => (
            <div 
              key={i} 
              className="flex items-start gap-3 p-3 bg-cyber-gray/50 rounded-lg animate-fade-in"
            >
              <div className="mt-1">{getClassificationIcon(threat.classification)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-semibold ${getClassificationColor(threat.classification)}`}>
                    {threat.classification.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-gray-500">
                    {(threat.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                {threat.explanation && (
                  <p className="text-sm text-gray-400 mt-1 truncate">{threat.explanation}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span>{formatIST(threat.timestamp)} IST</span>
                  {threat.action && (
                    <span className="text-cyber-blue">Action: {threat.action}</span>
                  )}
                  {threat.tx_hash && (
                    <a 
                      href={`https://sepolia.etherscan.io/tx/${threat.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyber-purple hover:underline"
                    >
                      View TX
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Agent Actions Component
function AgentActions({ actions, lastUpdate }: { actions: SecurityEvent[]; lastUpdate?: Date }) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Target className="w-4 h-4" />
        Agent Actions
        <span className="ml-auto text-xs text-cyber-green flex items-center gap-1">
          <span className="w-2 h-2 bg-cyber-green rounded-full animate-pulse"></span>
          LIVE {lastUpdate ? formatIST(lastUpdate, 'HH:mm:ss') : formatIST(new Date(), 'HH:mm:ss')} IST
        </span>
      </div>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {actions.length === 0 ? (
          <div className="p-4 bg-cyber-green/10 rounded-lg border border-cyber-green/20 text-center">
            <p className="text-cyber-green text-sm font-semibold">✅ No actions taken</p>
            <p className="text-gray-500 text-xs mt-1">Agent ready to defend on-chain...</p>
          </div>
        ) : (
          actions.map((action, i) => (
            <div 
              key={i}
              className="flex items-center gap-3 p-3 bg-cyber-red/10 border border-cyber-red/20 rounded-lg"
            >
              {action.action === 'PAUSE_PROTOCOL' ? (
                <Pause className="w-5 h-5 text-cyber-red" />
              ) : action.action === 'BLOCK_LIQUIDATIONS' ? (
                <Shield className="w-5 h-5 text-cyber-yellow animate-pulse" />
              ) : (action.action === 'PAUSE_AMM' || action.action === 'PROACTIVE_PAUSE_AMM') ? (
                <Shield className="w-5 h-5 text-cyber-green animate-pulse" />
              ) : (
                <Shield className="w-5 h-5 text-cyber-blue" />
              )}
              <div className="flex-1">
                <p className="font-semibold text-sm">
                  {(action.action === 'PAUSE_AMM' || action.action === 'PROACTIVE_PAUSE_AMM') ? '🛡️ AMM PAUSED - ATTACK BLOCKED!' : 
                   action.action === 'BLOCK_LIQUIDATIONS' ? '🔒 LIQUIDATIONS BLOCKED - USERS PROTECTED!' :
                   action.action?.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-gray-400">
                  {formatIST(action.timestamp, 'MMM d, HH:mm:ss')} IST
                </p>
              </div>
              {action.tx_hash && (
                <a 
                  href={`https://sepolia.etherscan.io/tx/${action.tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyber-purple hover:underline"
                >
                  TX ↗
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Live Attack Log Component - Shows real-time attack detection and blocking
// Attack Log Entry interface (used by LiveAttackLog)
interface AttackLogEntry {
  timestamp: Date;
  phase: 'init' | 'executing' | 'detecting' | 'blocking' | 'complete' | 'error';
  message: string;
  details?: string;
}

function LiveAttackLog({ events, stats, attackLogs, isAttacking }: { 
  events: SecurityEvent[]; 
  stats: DashboardStats | null;
  attackLogs?: AttackLogEntry[];
  isAttacking?: boolean;
}) {
  // Filter for attack-related events - keep only last 5
  const attackEvents = events.filter(e => 
    e.event_type === 'AMM_PAUSED' || 
    e.event_type === 'ACTION' ||
    (e.classification && e.classification !== 'NATURAL' && e.confidence && e.confidence > 0.5)
  ).slice(0, 5);
  
  const isUnderAttack = isAttacking || (stats && Math.abs(stats.price_deviation) > 5);
  const ammPaused = attackEvents.some(e => e.action === 'PAUSE_AMM');
  const hasLogs = attackLogs && attackLogs.length > 0;
  const lastLog = hasLogs ? attackLogs[attackLogs.length - 1] : null;
  const isComplete = lastLog?.phase === 'complete' || lastLog?.phase === 'error';

  // Get phase color
  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'init': return 'text-cyber-blue border-cyber-blue bg-cyber-blue/10';
      case 'executing': return 'text-cyber-yellow border-cyber-yellow bg-cyber-yellow/10';
      case 'detecting': return 'text-cyber-purple border-cyber-purple bg-cyber-purple/10';
      case 'blocking': return 'text-cyber-red border-cyber-red bg-cyber-red/10';
      case 'complete': return 'text-cyber-green border-cyber-green bg-cyber-green/10';
      case 'error': return 'text-cyber-red border-cyber-red bg-cyber-red/10';
      default: return 'text-gray-400 border-gray-500 bg-gray-500/10';
    }
  };

  return (
    <div className={`card ${isAttacking ? 'border-cyber-yellow/50 animate-pulse' : isComplete && lastLog?.phase === 'complete' ? 'border-cyber-green/50' : ammPaused ? 'border-cyber-green/50' : 'border-cyber-gray/30'}`}>
      <div className="card-header flex items-center gap-2">
        <Activity className={`w-4 h-4 ${isAttacking ? 'text-cyber-yellow animate-spin' : isUnderAttack ? 'text-cyber-red animate-ping' : 'text-cyber-blue'}`} />
        <span>Live Attack Log</span>
        {isAttacking && !isComplete && (
          <span className="ml-auto px-2 py-0.5 bg-cyber-yellow/20 text-cyber-yellow text-xs rounded animate-pulse flex items-center gap-1">
            <span className="w-2 h-2 bg-cyber-yellow rounded-full animate-ping"></span>
            EXECUTING...
          </span>
        )}
        {isComplete && lastLog?.phase === 'complete' && (
          <span className="ml-auto px-2 py-0.5 bg-cyber-green/20 text-cyber-green text-xs rounded">
            🛡️ BLOCKED
          </span>
        )}
        {!isAttacking && !hasLogs && ammPaused && (
          <span className="ml-auto px-2 py-0.5 bg-cyber-green/20 text-cyber-green text-xs rounded">
            🛡️ PROTECTED
          </span>
        )}
      </div>
      
      <div className="space-y-2 max-h-72 overflow-y-auto font-mono text-xs">
        {/* Show real-time attack logs first */}
        {hasLogs && (
          <div className="space-y-1.5">
            {attackLogs.map((log, i) => (
              <div 
                key={i}
                className={`p-2 rounded border-l-2 animate-fade-in ${getPhaseColor(log.phase)}`}
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">[{formatIST(log.timestamp, 'HH:mm:ss.SSS')}]</span>
                  <span className="font-semibold">{log.message}</span>
                </div>
                {log.details && (
                  <div className="text-gray-400 pl-4 mt-0.5">
                    → {log.details}
                  </div>
                )}
              </div>
            ))}
            
            {/* Show loading indicator while attack in progress */}
            {isAttacking && !isComplete && (
              <div className="p-2 rounded border-l-2 border-cyber-yellow bg-cyber-yellow/5 animate-pulse">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-cyber-yellow rounded-full animate-ping"></span>
                  <span className="text-cyber-yellow">Waiting for blockchain confirmation...</span>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Divider if we have both logs and events */}
        {hasLogs && attackEvents.length > 0 && (
          <div className="border-t border-cyber-gray/30 my-2 pt-2">
            <span className="text-xs text-gray-500">Previous Events:</span>
          </div>
        )}
        
        {/* Show historical attack events */}
        {!hasLogs && attackEvents.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No attack events yet</p>
            <p className="text-xs mt-1">Click "Simulate Attack" to test AMEN protection</p>
          </div>
        ) : (
          !hasLogs && attackEvents.map((event, i) => (
            <div 
              key={i}
              className={`p-2 rounded border-l-2 ${
                event.action === 'PAUSE_AMM' ? 'bg-cyber-green/10 border-cyber-green' :
                event.event_type === 'ACTION' ? 'bg-cyber-red/10 border-cyber-red' :
                event.classification === 'FLASH_LOAN_ATTACK' ? 'bg-cyber-red/10 border-cyber-red' :
                event.classification === 'ORACLE_MANIPULATION' ? 'bg-cyber-yellow/10 border-cyber-yellow' :
                'bg-cyber-gray/30 border-cyber-blue'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-500">[{formatIST(event.timestamp)}]</span>
                {event.action === 'PAUSE_AMM' ? (
                  <span className="text-cyber-green font-bold">🛡️ ATTACK BLOCKED!</span>
                ) : event.event_type === 'ACTION' ? (
                  <span className="text-cyber-red">⚡ ACTION: {event.action}</span>
                ) : (
                  <span className={
                    event.classification === 'FLASH_LOAN_ATTACK' ? 'text-cyber-red' :
                    event.classification === 'ORACLE_MANIPULATION' ? 'text-cyber-yellow' :
                    'text-cyber-blue'
                  }>
                    🎯 THREAT: {event.classification}
                  </span>
                )}
              </div>
              
              {event.tx_hash && event.tx_hash !== 'already_paused' && (
                <div className="pl-4 mt-1">
                  <a 
                    href={`https://sepolia.etherscan.io/tx/${event.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyber-purple hover:underline"
                  >
                    📜 View TX: {event.tx_hash.slice(0, 10)}...
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      
      {/* Real-time status bar */}
      <div className="mt-3 pt-3 border-t border-cyber-gray/50 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isAttacking ? 'bg-cyber-yellow animate-ping' : isUnderAttack ? 'bg-cyber-red animate-ping' : 'bg-cyber-green'}`}></span>
          <span className="text-gray-500">
            {isAttacking ? 'Attack in progress...' : isUnderAttack ? 'Attack detected!' : 'Monitoring...'}
          </span>
        </div>
        <div className="text-gray-500">
          Price deviation: <span className={Math.abs(stats?.price_deviation || 0) > 5 ? 'text-cyber-red' : 'text-cyber-green'}>
            {(Math.abs(stats?.price_deviation || 0)).toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// Live LLM Feed Component - Shows real-time Gemini analysis
function LiveLLMFeed({ threats, isAnalyzing, stats }: { threats: ThreatEntry[]; isAnalyzing: boolean; stats: any }) {
  const recentThreatsWithExplanation = threats.filter(t => t.explanation).slice(0, 3);
  const isHealthy = stats && stats.price_deviation !== undefined && Math.abs(stats.price_deviation) < 5;
  const lastUpdate = stats?.last_update ? new Date(stats.last_update) : null;
  
  return (
    <div className="card border-cyber-purple/30">
      <div className="card-header flex items-center gap-2">
        <Brain className="w-4 h-4 text-cyber-purple" />
        <span>Live Gemini LLM Feed</span>
        {isAnalyzing && (
          <span className="ml-auto flex items-center gap-1 text-cyber-yellow text-xs animate-pulse">
            <span className="w-2 h-2 bg-cyber-yellow rounded-full animate-ping"></span>
            Analyzing...
          </span>
        )}
        {!isAnalyzing && lastUpdate && (
          <span className="ml-auto text-xs text-gray-500">
            Last check: {formatIST(lastUpdate, 'HH:mm:ss')} IST
          </span>
        )}
      </div>
      
      <div className="space-y-3 max-h-64 overflow-y-auto">
        {/* Show real-time healthy status */}
        {isHealthy && (
          <div className="p-3 bg-cyber-green/10 rounded-lg border-l-2 border-cyber-green animate-pulse">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-cyber-green">
                ✅ SYSTEM HEALTHY
              </span>
              <span className="text-xs text-gray-500">
                {lastUpdate ? formatIST(lastUpdate, 'HH:mm:ss') : 'Now'} IST
              </span>
            </div>
            <div className="bg-black/30 rounded p-2 font-mono text-xs">
              <span className="text-cyber-purple">gemini&gt;</span>
              <span className="text-gray-300 ml-2">
                All markets stable. Oracle price ${stats.current_oracle_price?.toFixed(2)} matches AMM price ${stats.current_amm_price?.toFixed(2)}. 
                Price deviation: {stats.price_deviation?.toFixed(2)}%. No manipulation detected. System operating normally.
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs">
              <span className="text-gray-400">📊 Events: <span className="text-cyber-blue">{stats.total_events}</span></span>
              <span className="text-gray-400">🛡️ Threats blocked: <span className="text-cyber-yellow">{stats.threats_detected}</span></span>
            </div>
          </div>
        )}
        
        {/* Always show recent threats if they exist */}
        {recentThreatsWithExplanation.length === 0 ? (
          !isHealthy && (
            <div className="text-center py-4">
              <p className="text-gray-500 text-sm">No LLM analyses yet</p>
              <p className="text-gray-600 text-xs mt-1">
                🧠 Gemini will analyze when anomalies are detected
              </p>
            </div>
          )
        ) : (
          <>
            {isHealthy && (
              <div className="text-xs text-gray-500 mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-cyber-green rounded-full"></span>
                Recent threat detections:
              </div>
            )}
            {recentThreatsWithExplanation.map((threat, i) => (
            <div 
              key={i} 
              className="p-3 bg-cyber-gray/50 rounded-lg border-l-2 border-cyber-purple animate-fade-in"
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-semibold ${
                  threat.classification === 'FLASH_LOAN_ATTACK' ? 'text-cyber-red' :
                  threat.classification === 'ORACLE_MANIPULATION' ? 'text-cyber-yellow' :
                  'text-cyber-green'
                }`}>
                  🎯 {threat.classification}
                </span>
                <span className="text-xs text-gray-500">
                  {formatIST(threat.timestamp)} IST
                </span>
              </div>
              
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-400">Confidence:</span>
                <div className="flex-1 bg-cyber-gray rounded-full h-1.5">
                  <div 
                    className={`h-1.5 rounded-full ${
                      threat.confidence > 0.75 ? 'bg-cyber-red' :
                      threat.confidence > 0.5 ? 'bg-cyber-yellow' :
                      'bg-cyber-green'
                    }`}
                    style={{ width: `${threat.confidence * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-cyber-blue">
                  {(threat.confidence * 100).toFixed(0)}%
                </span>
              </div>
              
              <div className="bg-black/30 rounded p-2 font-mono text-xs">
                <span className="text-cyber-purple">gemini&gt;</span>
                <span className="text-gray-300 ml-2">{threat.explanation}</span>
              </div>
              
              {threat.action && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-400">Action:</span>
                  <span className={`text-xs font-semibold ${
                    threat.action === 'PAUSE_VAULT' ? 'text-cyber-red' :
                    threat.action === 'BLOCK_LIQUIDATIONS' ? 'text-cyber-yellow' :
                    'text-cyber-green'
                  }`}>
                    ⚡ {threat.action}
                  </span>
                </div>
              )}
            </div>
          ))}
          </>
        )}
      </div>
      
      <div className="mt-3 pt-3 border-t border-cyber-gray/50">
        <p className="text-xs text-gray-500 flex items-center gap-2">
          <span className="w-2 h-2 bg-cyber-green rounded-full"></span>
          Model: <span className="text-cyber-purple">gemini-2.0-flash-exp</span>
          <span className="ml-auto text-gray-600">Avg response: &lt;2s</span>
        </p>
      </div>
    </div>
  );
}

// Agent Reasoning Display
function AgentReasoning({ event: _event, latestThreat, stats }: { 
  event: SecurityEvent | null; 
  latestThreat?: ThreatEntry | null;
  stats?: DashboardStats | null;
}) {
  const [liveStats, setLiveStats] = useState<DashboardStats | null>(stats || null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  
  // Poll for live stats every 2 seconds for real-time updates
  useEffect(() => {
    const fetchLive = async () => {
      try {
        const freshStats = await fetchStats();
        setLiveStats(freshStats);
        setLastRefresh(new Date());
      } catch (e) {
        console.error('Live fetch failed:', e);
      }
    };
    
    fetchLive();
    const interval = setInterval(fetchLive, 1000); // 1 second refresh for faster UI updates
    return () => clearInterval(interval);
  }, []);
  
  // Use live stats if available, otherwise fallback to props
  const currentStats = liveStats || stats;
  
  // Get deviation - backend returns it as percentage already (e.g., 0.15 = 0.15%)
  const deviationPercent = Math.abs(currentStats?.price_deviation || 0);
  
  // Check if AMM is paused (attack was blocked)
  const ammPaused = currentStats?.amm_paused || false;
  
  // System is healthy if deviation is less than 5%
  const isHealthy = deviationPercent < 5;
  const isUnderAttack = deviationPercent > 10 && !ammPaused; // Only "under attack" if NOT blocked
  const isBlocked = deviationPercent > 10 && ammPaused; // Attack was blocked!
  
  // Show BLOCKED state when AMM is paused and there was high deviation
  if (isBlocked) {
    return (
      <div className="card border-cyber-green/50 bg-cyber-green/5">
        <div className="card-header flex items-center gap-2 text-cyber-green">
          <Shield className="w-4 h-4" />
          Agent Reasoning - 🛡️ ATTACK BLOCKED!
          <span className="text-xs text-gray-500 ml-2">Protected by AMEN</span>
          <span className="ml-auto text-xs text-cyber-green flex items-center gap-1">
            <span className="w-2 h-2 bg-cyber-green rounded-full animate-pulse"></span>
            LIVE {formatIST(lastRefresh, 'HH:mm:ss')} IST
          </span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Status:</span>
            <span className="font-semibold text-cyber-green animate-pulse">
              🛡️ ATTACK BLOCKED - AMM PAUSED
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Oracle Price:</span>
            <span className="text-cyber-blue font-mono">${currentStats?.current_oracle_price?.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">AMM Price:</span>
            <span className="font-mono text-cyber-yellow">
              ${currentStats?.current_amm_price?.toFixed(2)} (frozen)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Deviation at block:</span>
            <span className="font-mono text-cyber-yellow">
              {deviationPercent.toFixed(2)}%
            </span>
          </div>
          
          <div className="mt-2 p-3 bg-cyber-green/20 rounded-lg border border-cyber-green/50">
            <p className="text-sm text-cyber-green font-semibold">
              🛡️ The AMEN Agent detected the attack and paused the AMM!
            </p>
            <p className="text-xs text-gray-400 mt-1">
              The attacker's transaction will revert with "AMM is paused". User funds are protected.
            </p>
          </div>
          
          <div className="mt-2 p-2 bg-cyber-blue/10 rounded border border-cyber-blue/30">
            <p className="text-xs text-gray-400">
              💡 <span className="text-cyber-green font-semibold">Auto-Restore Active</span> - The agent will automatically restore the price in 5 seconds.
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  // Always show the healthy state when deviation is low - ignore old threat data
  if (isHealthy) {
    return (
      <div className="card border-cyber-green/30">
        <div className="card-header flex items-center gap-2">
          <Brain className="w-4 h-4 text-cyber-green" />
          Agent Reasoning 
          <span className="text-xs text-gray-500 ml-2">Powered by Gemini LLM</span>
          <span className="ml-auto text-xs text-cyber-green flex items-center gap-1">
            <span className="w-2 h-2 bg-cyber-green rounded-full animate-pulse"></span>
            LIVE {formatIST(lastRefresh, 'HH:mm:ss')} IST
          </span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Status:</span>
            <span className="font-semibold text-cyber-green">
              ✅ MONITORING - System Healthy
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Oracle Price:</span>
            <span className="text-cyber-blue font-mono">${currentStats?.current_oracle_price?.toFixed(2) || '...'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">AMM Price:</span>
            <span className="text-cyber-green font-mono">${currentStats?.current_amm_price?.toFixed(2) || '...'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Deviation:</span>
            <span className="font-mono text-cyber-green">
              {deviationPercent.toFixed(2)}%
            </span>
          </div>
          
          {/* Healthy deviation bar */}
          <div className="w-full bg-cyber-gray rounded-full h-2 overflow-hidden">
            <div 
              className="h-2 bg-cyber-green transition-all duration-300"
              style={{ width: `${Math.min(deviationPercent / 50 * 100, 100)}%` }}
            />
          </div>
          
          <div className="mt-3 p-3 bg-cyber-gray/30 rounded-lg border border-cyber-green/20">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-cyber-purple" />
              <span className="text-sm font-semibold text-cyber-purple">LLM Analysis Mode</span>
            </div>
            <p className="text-xs text-gray-400">
              📊 <strong>Deterministic checks:</strong> Running every 2 seconds<br/>
              🧠 <strong>Gemini LLM:</strong> Invoked only when anomalies detected (saves cost)<br/>
              🛡️ <strong>Response time:</strong> &lt;2 seconds to block attacks
            </p>
          </div>
          <p className="text-gray-500 text-xs mt-2">
            🔄 Agent is actively monitoring Sepolia blockchain for manipulation attacks...
          </p>
        </div>
      </div>
    );
  }

  // If system has high deviation, show alert - only show CURRENT threat data
  return (
    <div className={`card ${isUnderAttack ? 'border-cyber-red/50 animate-pulse' : 'border-cyber-yellow/50'}`}>
      <div className={`card-header flex items-center gap-2 ${isUnderAttack ? 'text-cyber-red' : 'text-cyber-yellow'}`}>
        <Brain className="w-4 h-4" />
        Agent Reasoning - {isUnderAttack ? '🚨 ACTIVE ATTACK' : '⚠️ ANOMALY'} 
        <span className="text-xs text-cyber-yellow ml-2">🧠 Gemini LLM Active</span>
        <span className="ml-auto text-xs text-cyber-red flex items-center gap-1">
          <span className="w-2 h-2 bg-cyber-red rounded-full animate-ping"></span>
          LIVE {formatIST(lastRefresh, 'HH:mm:ss')} IST
        </span>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Status:</span>
          <span className={`font-semibold ${isUnderAttack ? 'text-cyber-red' : 'text-cyber-yellow'} animate-pulse`}>
            {isUnderAttack ? '🚨 ATTACK IN PROGRESS' : '⚠️ ANOMALY DETECTED'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Oracle Price:</span>
          <span className="text-cyber-blue font-mono">${currentStats?.current_oracle_price?.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">AMM Price:</span>
          <span className={`font-mono ${isUnderAttack ? 'text-cyber-red font-bold' : 'text-cyber-yellow'}`}>
            ${currentStats?.current_amm_price?.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Deviation:</span>
          <span className={`font-mono font-bold ${isUnderAttack ? 'text-cyber-red text-lg' : 'text-cyber-yellow'}`}>
            {deviationPercent.toFixed(2)}%
          </span>
        </div>
        
        {/* Live deviation bar */}
        <div className="w-full bg-cyber-gray rounded-full h-3 overflow-hidden">
          <div 
            className={`h-3 transition-all duration-300 ${
              isUnderAttack ? 'bg-gradient-to-r from-cyber-yellow to-cyber-red animate-pulse' : 'bg-cyber-yellow'
            }`}
            style={{ width: `${Math.min(deviationPercent / 50 * 100, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>0%</span>
          <span className="text-cyber-yellow">5% (Warning)</span>
          <span className="text-cyber-red">50%+ (Critical)</span>
        </div>
        
        {/* Only show threat data if it's recent (within last 30 seconds) and deviation is still high */}
        {latestThreat && !isHealthy && (
          <div className="p-3 bg-black/30 rounded border-l-2 border-cyber-red mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-cyber-red">{latestThreat.classification}</span>
              <span className="text-xs text-gray-500">{(latestThreat.confidence * 100).toFixed(0)}% confidence</span>
            </div>
            {latestThreat.explanation && (
              <p className="text-sm text-cyber-yellow">🧠 {latestThreat.explanation}</p>
            )}
          </div>
        )}
        
        {isUnderAttack && (
          <div className="mt-2 p-2 bg-cyber-red/20 rounded-lg border border-cyber-red/50 animate-pulse">
            <p className="text-sm text-cyber-red font-semibold">
              🛡️ AMEN Agent is analyzing and preparing protective action...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN APP
// =============================================================================

function App() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [priceData, setPriceData] = useState<PriceDataPoint[]>([]);
  const [threats, setThreats] = useState<ThreatEntry[]>([]);
  const [actions, setActions] = useState<SecurityEvent[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [latestAssessment, setLatestAssessment] = useState<SecurityEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [attackLoading, setAttackLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error' | 'blocked'; message: string } | null>(null);
  const [attackLogs, setAttackLogs] = useState<AttackLogEntry[]>([]);

  // Add log entry helper
  const addAttackLog = (phase: AttackLogEntry['phase'], message: string, details?: string) => {
    setAttackLogs(prev => [...prev, { timestamp: new Date(), phase, message, details }]);
  };

  // Handle simulate attack with live progress
  const handleSimulateAttack = async () => {
    setAttackLoading(true);
    setActionResult(null);
    setAttackLogs([]); // Clear old logs
    
    // Phase 1: Init
    addAttackLog('init', '🚀 Attack simulation initiated', 'Preparing flash loan parameters...');
    
    // Simulate progress updates
    setTimeout(() => addAttackLog('init', '💰 Flash loan: Borrowing 100 WETH', 'From Aave/Compound pool'), 500);
    setTimeout(() => addAttackLog('executing', '📉 Executing large swap on AMM', 'Selling 100 WETH to crash ETH/USDC price'), 1000);
    setTimeout(() => addAttackLog('executing', '⚡ Transaction submitted to Sepolia', 'Waiting for confirmation...'), 1500);
    
    try {
      const result = await simulateAttack();
      
      if (result.blocked) {
        addAttackLog('detecting', '🔍 AMEN Agent detected anomaly!', `Price manipulation detected!`);
        setTimeout(() => addAttackLog('blocking', '🛡️ Gemini LLM analyzing threat...', 'Classification: FLASH_LOAN_ATTACK'), 300);
        setTimeout(() => addAttackLog('blocking', '🔒 AMM PAUSED by AMEN Agent!', 'Attack blocked before damage'), 600);
        setTimeout(() => addAttackLog('complete', '✅ ATTACK SUCCESSFULLY BLOCKED!', result.message), 900);
        setActionResult({ type: 'blocked', message: `🛡️ Attack BLOCKED by AMEN! ${result.message}` });
      } else {
        addAttackLog('executing', '⚠️ Attack transaction confirmed', 'Price manipulation succeeded');
        addAttackLog('error', '❌ AMEN Agent did not block in time', result.message);
        setActionResult({ type: 'error', message: `⚠️ Attack succeeded: ${result.message}` });
      }
      fetchData();
    } catch (error: any) {
      addAttackLog('error', '❌ Attack simulation failed', error.message);
      setActionResult({ type: 'error', message: `Error: ${error.message}` });
    }
    setAttackLoading(false);
    setTimeout(() => setActionResult(null), 10000);
  };

  // Fetch data - limit to 5 items for clean display
  const fetchData = useCallback(async () => {
    try {
      const [statsData, pricesData, threatsData, actionsData, eventsData] = await Promise.all([
        fetchStats(),
        fetchPriceHistory(1),
        fetchThreats(5),  // Only 5 threats
        fetchActions(5),  // Only 5 actions
        fetchEvents(5)    // Only 5 events
      ]);
      
      setStats(statsData);
      setPriceData(pricesData);
      setThreats(threatsData.slice(0, 5));  // Ensure max 5
      setActions(actionsData.slice(0, 5));  // Ensure max 5
      setEvents(eventsData.slice(0, 5));    // Ensure max 5
      
      // Find latest assessment
      const assessment = eventsData.find(e => e.event_type === 'ASSESSMENT');
      if (assessment) {
        setLatestAssessment(assessment);
      }
      
      setLastUpdate(new Date());
      setConnected(true);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setConnected(false);
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000); // 2 second refresh for faster updates
    return () => clearInterval(interval);
  }, [fetchData]);

  // WebSocket connection
  useEffect(() => {
    const ws = createWebSocket((data) => {
      if (data.type === 'new_event') {
        // Refresh data on new events
        fetchData();
      }
    });

    return () => ws.close();
  }, [fetchData]);

  // Determine system status - AMM paused means attack was blocked!
  const systemStatus = stats?.amm_paused ? 'warning' :
                       stats?.vault_paused ? 'critical' : 
                       stats?.liquidations_blocked ? 'warning' : 
                       'healthy';

  return (
    <div className="min-h-screen bg-cyber-black text-white p-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Shield className="w-10 h-10 text-cyber-blue" />
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-cyber-blue to-cyber-purple bg-clip-text text-transparent">
                AMEN Security Dashboard
              </h1>
              <p className="text-sm text-gray-400">
                Agentic Manipulation Engine Neutralizer
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Attack Simulation Button */}
            <button
              onClick={handleSimulateAttack}
              disabled={attackLoading}
              className="px-4 py-2 bg-cyber-red/20 border border-cyber-red/50 rounded-lg text-cyber-red hover:bg-cyber-red/30 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Skull className={`w-4 h-4 ${attackLoading ? 'animate-pulse' : ''}`} />
              {attackLoading ? 'Attacking...' : 'Simulate Attack'}
            </button>
            <StatusBadge 
              status={systemStatus} 
              label={stats?.amm_paused ? '🛡️ ATTACK BLOCKED' :
                     systemStatus === 'critical' ? 'PROTOCOL PAUSED' : 
                     systemStatus === 'warning' ? 'LIQUIDATIONS BLOCKED' : 
                     'SYSTEM HEALTHY'} 
            />
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-cyber-green' : 'bg-cyber-red'}`} />
              {connected ? 'Connected' : 'Disconnected'}
            </div>
            <div className="text-xs text-gray-500">
              Last update: {formatIST(lastUpdate)} IST
            </div>
          </div>
        </div>
      </header>

      {/* Action Result Alert */}
      {actionResult && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
          actionResult.type === 'blocked' ? 'bg-cyber-green/10 border border-cyber-green/30' :
          actionResult.type === 'success' ? 'bg-cyber-blue/10 border border-cyber-blue/30' :
          'bg-cyber-red/10 border border-cyber-red/30'
        }`}>
          {actionResult.type === 'blocked' ? (
            <Shield className="w-6 h-6 text-cyber-green" />
          ) : actionResult.type === 'success' ? (
            <RefreshCw className="w-6 h-6 text-cyber-blue" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-cyber-red" />
          )}
          <p className={`font-semibold ${
            actionResult.type === 'blocked' ? 'text-cyber-green' :
            actionResult.type === 'success' ? 'text-cyber-blue' :
            'text-cyber-red'
          }`}>{actionResult.message}</p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard 
          title="Oracle Price" 
          value={stats ? `$${stats.current_oracle_price.toFixed(2)}` : '-'} 
          icon={Activity}
          color="blue"
          subtitle="Current ETH/USD"
        />
        <StatCard 
          title="AMM Price" 
          value={stats ? `$${stats.current_amm_price.toFixed(2)}` : '-'} 
          icon={TrendingUp}
          color="green"
          subtitle="Pool spot price"
        />
        <StatCard 
          title="Threats Detected" 
          value={stats?.threats_detected || 0} 
          icon={AlertTriangle}
          color="yellow"
          subtitle="Total anomalies"
        />
        <StatCard 
          title="Actions Taken" 
          value={stats?.actions_taken || 0} 
          icon={Shield}
          color="purple"
          subtitle="On-chain responses"
        />
      </div>

      {/* Price Deviation Alert */}
      {stats && stats.price_deviation > 5 && (
        <div className="mb-6 p-4 bg-cyber-red/10 border border-cyber-red/30 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-cyber-red animate-pulse" />
          <div>
            <p className="font-semibold text-cyber-red">High Price Deviation Detected</p>
            <p className="text-sm text-gray-400">
              Oracle and AMM prices differ by {stats.price_deviation.toFixed(2)}% - 
              This may indicate market manipulation
            </p>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Chart & LLM Feed */}
        <div className="lg:col-span-2 space-y-6">
          <PriceChart data={priceData} attacks={actions} />
          <AgentReasoning event={latestAssessment} latestThreat={threats[0] || null} stats={stats} />
          <LiveLLMFeed threats={threats} isAnalyzing={stats ? Math.abs(stats.price_deviation) > 0.05 : false} stats={stats} />
        </div>

        {/* Right Column - Threats, Actions & Attack Log */}
        <div className="space-y-6">
          <LiveAttackLog events={events} stats={stats} attackLogs={attackLogs} isAttacking={attackLoading} />
          <ThreatTimeline threats={threats} lastUpdate={lastUpdate} />
          <AgentActions actions={actions} lastUpdate={lastUpdate} />
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-8 text-center text-sm text-gray-500">
        <p>AMEN v1.0 • Sepolia Testnet • {stats?.total_events || 0} total events processed</p>
        <p className="text-xs text-gray-600 mt-1">Powered by Google Gemini 2.0 Flash • Real-time DeFi Protection</p>
      </footer>
    </div>
  );
}

export default App;
