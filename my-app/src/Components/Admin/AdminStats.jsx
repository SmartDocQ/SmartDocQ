import React, { useMemo } from "react";
import "./AdminStats.css";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

// Constants moved outside component for performance
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const REPORT_TYPE_COLORS = {
  Feedback: '#22c55e',
  Bug: '#ef4444',
  'Feature Request': '#3b82f6',
  Other: '#a3a3a3'
};

const DEFAULT_PERFORMANCE = {
  documentProcessingTime: 150,
  queryResponseTime: 85,
  successRate: 98.5
};

// Utility function moved outside component
const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

// Optimized CustomTooltip component
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  
  return (
    <div className="custom-tooltip">
      <p className="tooltip-label">{label}</p>
      {payload.map((pld, index) => (
        <p key={index} style={{ color: pld.color }}>
          {`${pld.dataKey}: ${pld.value}`}
        </p>
      ))}
    </div>
  );
};

// Specific tooltip for pie chart to show report type names
const ReportTypeTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  
  const data = payload[0].payload;
  return (
    <div className="custom-tooltip">
      <p className="tooltip-label">{data.name}</p>
      <p style={{ color: data.color }}>
        {`Reports: ${data.value}`}
      </p>
    </div>
  );
};

const AdminStats = ({ data, onRefresh }) => {
  // Memoized enhanced stats to prevent unnecessary recalculations
  const enhancedStats = useMemo(() => {
    const stats = data || {};
    return {
      ...stats,
      performance: stats.performance || DEFAULT_PERFORMANCE
    };
  }, [data]);


  // Memoized weekly data generation
  const userGrowthData = useMemo(() => {
    return DAYS.map(day => ({
      name: day,
      newUsers: enhancedStats.weeklyUserGrowth?.[day] || 0,
      newReports: enhancedStats.weeklyReportGrowth?.[day] || 0
    }));
  }, [enhancedStats.weeklyUserGrowth, enhancedStats.weeklyReportGrowth]);

  // Memoized report types data (by content classification) - real data from backend
  const reportTypesData = useMemo(() => {
    const rt = enhancedStats.reportTypes;
    if (!rt) return [];
    return [
      { name: 'Feedback', value: rt.feedback || 0, color: REPORT_TYPE_COLORS.Feedback },
      { name: 'Bug', value: rt.bug || 0, color: REPORT_TYPE_COLORS.Bug },
      { name: 'Feature Request', value: rt.feature_request || 0, color: REPORT_TYPE_COLORS['Feature Request'] },
      { name: 'Other', value: rt.other || 0, color: REPORT_TYPE_COLORS.Other }
    ].filter(item => item.value > 0);
  }, [enhancedStats.reportTypes]);

    // Memoized user feedback data from backend (positive/negative counts)
    const feedbackData = useMemo(() => {
      const fs = enhancedStats.feedbackSummary || { positive: 0, negative: 0 };
      return [
        { type: 'Positive', count: fs.positive || 0, color: '#22c55e' },
        { type: 'Negative', count: fs.negative || 0, color: '#ef4444' }
      ];
    }, [enhancedStats.feedbackSummary]);

    // (Real-time sparklines moved to RealTimeMetrics component)

  // Memoized stat cards
  const statCards = useMemo(() => [
    {
      title: "Total Users",
      value: enhancedStats.totalUsers || 0,
      gradient: "linear-gradient(135deg, #00FF88, #00CC6A)",
      trend: enhancedStats.userGrowth || "0%",
      subtitle: "Registered users"
    },
    {
      title: "Documents", 
      value: enhancedStats.totalDocuments || 0,
      gradient: "linear-gradient(135deg, #00BFFF, #0099CC)",
      trend: enhancedStats.documentGrowth || "0%",
      subtitle: "Uploaded files"
    },
    {
      title: "Reports",
      value: enhancedStats.totalReports || 0,
      gradient: "linear-gradient(135deg, #9933FF, #7700CC)",
      trend: enhancedStats.chatGrowth || "0%",
      subtitle: "Messages from users"
    },
    {
      title: "Storage Used",
      value: formatBytes(enhancedStats.storageUsed || 0),
      gradient: "linear-gradient(135deg, #FF6B35, #E55A32)",
      trend: "Available",
      subtitle: `${formatBytes(536870912 - (enhancedStats.storageUsed || 0))} of 512MB`
    }
  ], [enhancedStats]);

  // (Latency percentiles and by-route p90 moved to RealTimeMetrics component)

  return (
    <div className="admin-stats">
      <div className="stats-header">
        <h2>Analytics Dashboard</h2>
        <button className="refresh-stats-btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        {statCards.map((stat, index) => (
          <div key={index} className="kpi-card">
            <div className="kpi-content">
              <div className="kpi-header">
                <span className="kpi-title">{stat.title}</span>
              </div>
              <div className="kpi-value">{stat.value}</div>
              <div className="kpi-trend">
                <span className="trend-value">{stat.trend}</span>
                <span className="trend-subtitle">{stat.subtitle}</span>
              </div>
            </div>
            <div className="kpi-gradient" style={{ background: stat.gradient }}></div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="charts-grid">
        {/* User Growth Chart */}
        <div className="chart-container">
          <h3 className="chart-title">User Growth</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={userGrowthData}>
              <defs>
                <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00FF88" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#00FF88" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 2" stroke="#333" />
              <XAxis dataKey="name" stroke="#888" />
              <YAxis stroke="#888" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="newUsers" stroke="#00FF88" fill="url(#colorUsers)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Report Types Pie Chart */}
        <div className="chart-container">
          <h3 className="chart-title">Report Types Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            {reportTypesData.length > 0 ? (
              <PieChart>
                <Pie
                  data={reportTypesData}
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={35}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={false}
                >
                  {reportTypesData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ReportTypeTooltip />} />
              </PieChart>
            ) : (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                height: '100%', 
                color: '#888',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ fontSize: '18px' }}>📄</div>
                <div>No report type data available</div>
                <div style={{ fontSize: '12px', opacity: 0.7 }}>
                  Backend needs to provide reportTypes data
                </div>
              </div>
            )}
          </ResponsiveContainer>
        </div>

        {/* User Feedback Chart */}
        <div className="chart-container">
          <h3 className="chart-title">User Feedback</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={feedbackData}>
              <CartesianGrid strokeDasharray="2 2" stroke="#333" />
              <XAxis dataKey="type" stroke="#888" />
              <YAxis stroke="#888" allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {feedbackData.map((entry, index) => (
                  <Cell key={`cell-fb-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Daily Activity Line Chart */}
        <div className="chart-container">
          <h3 className="chart-title">Daily Activity Timeline</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={userGrowthData}>
              <CartesianGrid strokeDasharray="2 2" stroke="#333" />
              <XAxis dataKey="name" stroke="#888" />
              <YAxis stroke="#888" />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="newUsers" stroke="#00FF88" strokeWidth={2} dot={{ fill: '#00FF88', r: 4 }} />
              <Line type="monotone" dataKey="newReports" stroke="#FF6B35" strokeWidth={2} dot={{ fill: '#FF6B35', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* (Latency Percentiles and Top Routes p90 now shown in RealTimeMetrics) */}
      </div>
      
    </div>
  );
};

export default AdminStats;