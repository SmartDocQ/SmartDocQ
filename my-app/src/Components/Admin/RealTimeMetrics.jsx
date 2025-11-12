import React, { useMemo } from "react";
import "./RealTimeMetrics.css";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rtm-tooltip">
      <p className="rtm-tooltip-title">{label}</p>
      {payload.map((pld, i) => (
        <p key={i} style={{ color: pld.color }}>{`${pld.dataKey}: ${pld.value}`}</p>
      ))}
    </div>
  );
};

const formatUptime = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h ${m}m ${r}s`;
};

const RealTimeMetrics = ({ stats, onRefresh }) => {
  const enhanced = useMemo(() => stats || {}, [stats]);
  const perf = useMemo(() => enhanced.performance || {}, [enhanced]);
  const runtime = useMemo(() => perf._runtime || {}, [perf]);

  const docProcessingSpark = useMemo(() => {
    const t = perf.documentProcessingTime || 0;
    if (!t) return [];
    return [{ time: Math.round(t * 0.9) }, { time: Math.round(t * 1.05) }, { time: t }];
  }, [perf.documentProcessingTime]);

  const queryResponseSpark = useMemo(() => {
    const t = perf.queryResponseTime || 0;
    if (!t) return [];
    return [{ time: Math.round(t * 0.95) }, { time: Math.round(t * 1.02) }, { time: t }];
  }, [perf.queryResponseTime]);

  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const userGrowthData = useMemo(() => {
    const map = enhanced.weeklyUserGrowth || {};
    return days.map(d => ({ name: d, newUsers: map[d] || 0 }));
  }, [enhanced.weeklyUserGrowth]);

  const latencyPercentiles = useMemo(() => {
    const p = perf.percentiles || {};
    return [
      { name: 'p50', ms: Math.round(p.p50 || 0) },
      { name: 'p90', ms: Math.round(p.p90 || 0) },
      { name: 'p99', ms: Math.round(p.p99 || 0) }
    ];
  }, [perf.percentiles]);

  const byRouteData = useMemo(() => {
    const r = Array.isArray(perf.byRoute) ? perf.byRoute : [];
    return r.map(x => ({ route: x.route || 'unknown', p90: x.p90Ms || 0, count: x.count || 0 }));
  }, [perf.byRoute]);

  return (
    <div className="rtm-wrapper">
      <div className="rtm-header">
        <h2>Real-time Metrics</h2>
        {onRefresh && (
          <button className="rtm-refresh" onClick={onRefresh}>Refresh</button>
        )}
      </div>

      <div className="rtm-grid">
        <div className="rtm-card">
          <div className="rtm-label">Online Users</div>
          <div className="rtm-value">{enhanced.onlineUsers || 0}</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <BarChart data={userGrowthData.slice(-3)}>
                <Bar dataKey="newUsers" fill="#00FF88" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rtm-card">
          <div className="rtm-label">Document Processing</div>
          <div className="rtm-value">{perf.documentProcessingTime || 0}ms</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <LineChart data={docProcessingSpark}>
                <Line type="monotone" dataKey="time" stroke="#00BFFF" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rtm-card">
          <div className="rtm-label">Query Response</div>
          <div className="rtm-value">{perf.queryResponseTime || 0}ms</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <LineChart data={queryResponseSpark}>
                <Line type="monotone" dataKey="time" stroke="#FF6B35" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rtm-card">
          <div className="rtm-label">Success Rate</div>
          <div className="rtm-value">{perf.successRate ?? 0}%</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <BarChart data={[{ rate: perf.successRate || 0 }]}> 
                <Bar dataKey="rate" fill="#9933FF" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rtm-card">
          <div className="rtm-label">CPU</div>
          <div className="rtm-value">{runtime.cpuPercent ?? 0}%</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <BarChart data={[{ v: runtime.cpuPercent || 0 }]}> 
                <Bar dataKey="v" fill="#22c55e" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rtm-card">
          <div className="rtm-label">Memory RSS</div>
          <div className="rtm-value">{runtime.memoryRssMB ?? 0} MB</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <BarChart data={[{ v: runtime.memoryRssMB || 0 }]}> 
                <Bar dataKey="v" fill="#3b82f6" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rtm-card">
          <div className="rtm-label">Uptime</div>
          <div className="rtm-value">{formatUptime(runtime.uptimeSec)}</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <LineChart data={[{t:0,u:0},{t:1,u:(runtime.uptimeSec||0)/60}]}> 
                <Line type="monotone" dataKey="u" stroke="#a3a3a3" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rtm-card">
          <div className="rtm-label">Requests Total</div>
          <div className="rtm-value">{runtime.requestsTotal ?? 0}</div>
          <div className="rtm-mini">
            <ResponsiveContainer width="100%" height={40}>
              <BarChart data={[{ v: runtime.requestsTotal || 0 }]}> 
                <Bar dataKey="v" fill="#8b5cf6" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="rtm-charts">
        <div className="rtm-chart-card">
          <div className="rtm-chart-title">Latency Percentiles (ms)</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={latencyPercentiles}>
              <CartesianGrid strokeDasharray="2 2" stroke="#333" />
              <XAxis dataKey="name" stroke="#888" />
              <YAxis stroke="#888" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="ms" fill="#00BFFF" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rtm-chart-card">
          <div className="rtm-chart-title">Top Routes p90 (ms)</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byRouteData}>
              <CartesianGrid strokeDasharray="2 2" stroke="#333" />
              <XAxis dataKey="route" stroke="#888" interval={0} angle={-20} textAnchor="end" height={60} tickFormatter={(v)=> (v && v.length>18 ? v.slice(0,18)+"…" : v)} />
              <YAxis stroke="#888" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="p90" fill="#FF6B35" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default RealTimeMetrics;
