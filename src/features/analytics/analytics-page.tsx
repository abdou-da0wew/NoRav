import { useCallback, useEffect, useState } from "react";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ChartLineUp } from "@phosphor-icons/react/ChartLineUp";
import { Clock } from "@phosphor-icons/react/Clock";
import { Globe } from "@phosphor-icons/react/Globe";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { Network } from "@phosphor-icons/react/Network";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Timer } from "@phosphor-icons/react/Timer";
import { Users } from "@phosphor-icons/react/Users";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { PageHeading } from "@/app/page-heading";
import { fetchAnalytics } from "@/lib/api";
import { formatBytes, formatDuration, formatUptime } from "@/lib/utils";
import type { AnalyticsSnapshot, RequestEvent } from "@/lib/types";

export function AnalyticsPage() {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await fetchAnalytics();
      setSnapshot(result);
      setError("");
      setLastUpdated(new Date());
    } catch {
      setError("Analytics could not be loaded. The gateway may still be starting.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return (
    <section className="analytics-page page-section">
      <div className="analytics-heading-row">
        <PageHeading
          title="Activity"
          description="Live request telemetry, client attribution and proxy performance."
          icon={<Pulse size={19} />}
        />
        <div className="analytics-refresh">
          {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={loading}>
            <ArrowClockwise size={15} /> Refresh
          </Button>
        </div>
      </div>

      {error && <div className="analytics-error" role="alert">{error}</div>}
      {snapshot ? (
        <>
          <div className="analytics-runtime">
            <div className="runtime-label"><span className="runtime-pulse" /> RUNTIME TELEMETRY</div>
            <div className="runtime-details">
              <span><Timer size={14} /> Up {formatUptime(snapshot.uptimeSeconds)}</span>
              <span><Network size={14} /> {snapshot.ioUring && snapshot.ioUringDial ? "Efficient request handling" : snapshot.ioUring ? "Efficient request handling" : "Standard network handling"}</span>
              <span><ShieldCheck size={14} /> Private destination guard</span>
            </div>
          </div>

          <div className="analytics-stats">
            <MetricCard label="Total requests" value={snapshot.requests.toLocaleString()} icon={<ChartLineUp size={17} />} detail="Since process start" />
            <MetricCard label="Average latency" value={formatDuration(snapshot.averageLatencyMs)} icon={<Clock size={17} />} detail="Across all handled routes" />
            <MetricCard label="Response traffic" value={formatBytes(snapshot.bytesOut)} icon={<HardDrives size={17} />} detail={`${formatBytes(snapshot.bytesIn)} request traffic`} />
            <MetricCard label="Error responses" value={snapshot.errors.toLocaleString()} icon={<ShieldCheck size={17} />} detail={snapshot.requests ? `${((snapshot.errors / snapshot.requests) * 100).toFixed(1)}% of requests` : "No requests yet"} />
          </div>

          <div className="analytics-grid">
            <section className="analytics-card">
              <div className="analytics-card-heading"><div><h2>Most requested destinations</h2><p>Top upstream hostnames</p></div><Globe size={17} /></div>
              {snapshot.topHosts.length ? (
                <div className="host-list">
                  {snapshot.topHosts.slice(0, 8).map((host, index) => (
                    <div className="host-row" key={host.host}>
                      <span className="host-rank">{String(index + 1).padStart(2, "0")}</span>
                      <span className="host-name">{host.host}</span>
                      <span className="host-count">{host.requests.toLocaleString()}</span>
                      <div className="host-bar"><span style={{ width: `${Math.max(3, host.requests / Math.max(1, snapshot.topHosts[0]?.requests ?? 1) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState message="Destination activity will appear here." />}
            </section>
            <section className="analytics-card">
              <div className="analytics-card-heading"><div><h2>Response codes</h2><p>HTTP status distribution</p></div><Pulse size={17} /></div>
              <StatusDistribution statuses={snapshot.statuses} total={snapshot.requests} />
              <div className="method-pills">
                {Object.entries(snapshot.methods).map(([method, count]) => (
                  <div key={method}><span>{method}</span><strong>{count.toLocaleString()}</strong></div>
                ))}
              </div>
            </section>
          </div>

          <section className="analytics-card ip-card">
            <div className="analytics-card-heading">
              <div><h2>Client IP activity</h2><p>Per-IP request counts, transferred bytes and recent access</p></div>
              <Badge tone="neutral"><Users size={13} /> {snapshot.topIPs.length} tracked</Badge>
            </div>
            <div className="table-scroll">
              <table className="activity-table">
                <thead><tr><th>Client IP</th><th>Requests</th><th>Errors</th><th>Received</th><th>Sent</th><th>Last seen</th></tr></thead>
                <tbody>
                  {snapshot.topIPs.map(client => (
                    <tr key={client.ip}>
                      <td className="mono ip-value">{client.ip}</td>
                      <td>{client.requests.toLocaleString()}</td>
                      <td><span className={client.errors ? "error-count" : "quiet-count"}>{client.errors}</span></td>
                      <td>{formatBytes(client.bytesIn)}</td>
                      <td>{formatBytes(client.bytesOut)}</td>
                      <td>{new Date(client.lastSeen).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                  {!snapshot.topIPs.length && <tr><td colSpan={6} className="empty-cell">No client requests have been recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="analytics-card requests-card">
            <div className="analytics-card-heading">
              <div><h2>Recent requests</h2><p>Correlated request IDs and distributed trace IDs</p></div>
              <Badge tone="success" dot>Live</Badge>
            </div>
            <div className="table-scroll">
              <table className="activity-table requests-table">
                <thead><tr><th>Time</th><th>Method</th><th>Destination</th><th>Status</th><th>Latency</th><th>Client IP</th><th>Trace ID</th></tr></thead>
                <tbody>
                  {snapshot.recentRequests.slice(0, 40).map(event => <RequestRow key={event.requestId} event={event} />)}
                  {!snapshot.recentRequests.length && <tr><td colSpan={7} className="empty-cell">No requests recorded yet. Open a website to populate this table.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : !loading && !error ? <EmptyState message="No telemetry is available yet." /> : null}
    </section>
  );
}

function MetricCard({ label, value, icon, detail }: {
  label: string; value: string; icon: React.ReactNode; detail: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StatusDistribution({ statuses, total }: { statuses: Record<string, number>; total: number }) {
  const entries = Object.entries(statuses).sort(([a], [b]) => Number(a) - Number(b));
  const groups = [
    { label: "2xx", count: entries.filter(([code]) => code.startsWith("2")).reduce((sum, [, n]) => sum + n, 0), tone: "success" },
    { label: "3xx", count: entries.filter(([code]) => code.startsWith("3")).reduce((sum, [, n]) => sum + n, 0), tone: "info" },
    { label: "4xx", count: entries.filter(([code]) => code.startsWith("4")).reduce((sum, [, n]) => sum + n, 0), tone: "warning" },
    { label: "5xx", count: entries.filter(([code]) => code.startsWith("5")).reduce((sum, [, n]) => sum + n, 0), tone: "danger" },
  ];
  return (
    <div className="status-distribution">
      <div className="status-stack">
        {groups.map(group => <span key={group.label} className={`status-segment ${group.tone}`} style={{ width: total ? `${group.count / total * 100}%` : "0%" }} />)}
      </div>
      {groups.map(group => (
        <div className="status-legend" key={group.label}>
          <span><i className={group.tone} />{group.label}</span><strong>{group.count}</strong>
        </div>
      ))}
    </div>
  );
}

function RequestRow({ event }: { event: RequestEvent }) {
  const tone = event.status >= 500 ? "danger" : event.status >= 400 ? "warning" : event.status >= 300 ? "info" : "success";
  return (
    <tr>
      <td>{new Date(event.time).toLocaleTimeString()}</td>
      <td><span className="method-pill">{event.method}</span></td>
      <td className="destination-cell">{event.host || event.path}</td>
      <td><Badge tone={tone}>{event.status}</Badge></td>
      <td>{formatDuration(event.durationMs)}</td>
      <td className="mono">{event.clientIp}</td>
      <td className="mono trace-value" title={event.traceId}>{event.traceId.slice(0, 12)}</td>
    </tr>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="analytics-empty"><Pulse size={19} /><span>{message}</span></div>;
}
