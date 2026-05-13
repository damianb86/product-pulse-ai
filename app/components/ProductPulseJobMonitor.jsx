import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";

export function ProductPulseJobMonitor({ initialMonitor, developmentMode = false }) {
  const fetcher = useFetcher();
  const [minimized, setMinimized] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("productPulseDevJobsMinimized") === "true";
  });
  const [now, setNow] = useState(() => Date.now());
  const monitor = fetcher.data?.jobMonitor || initialMonitor || {};
  const activeJobs = useMemo(() => monitor.activeJobs || [], [monitor.activeJobs]);
  const recentJobs = useMemo(() => monitor.recentJobs || [], [monitor.recentJobs]);
  const logs = useMemo(() => monitor.logs || [], [monitor.logs]);
  const hasActiveJobs = activeJobs.length > 0;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!developmentMode && !hasActiveJobs) return undefined;
    const interval = window.setInterval(() => {
      fetcher.load("/app/job-status");
    }, hasActiveJobs ? 2000 : 5000);
    return () => window.clearInterval(interval);
  }, [developmentMode, fetcher, hasActiveJobs]);

  useEffect(() => {
    if (!hasActiveJobs && fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/app/job-status");
    }
  }, [fetcher, hasActiveJobs]);

  const groupedLogs = useMemo(() => {
    const byJob = new Map();
    logs.forEach((log) => {
      if (!byJob.has(log.jobId)) byJob.set(log.jobId, []);
      byJob.get(log.jobId).push(log);
    });
    return byJob;
  }, [logs]);

  const toggleMinimized = () => {
    setMinimized((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("productPulseDevJobsMinimized", String(next));
      }
      return next;
    });
  };

  if (!developmentMode && !hasActiveJobs) return null;

  if (minimized) {
    return (
      <button className="ppJobDockMinimized" type="button" onClick={toggleMinimized}>
        <span className={hasActiveJobs ? "isRunning" : ""} />
        {hasActiveJobs ? `${activeJobs.length} job${activeJobs.length === 1 ? "" : "s"} running` : "Dev jobs"}
      </button>
    );
  }

  if (!developmentMode) {
    return (
      <aside className="ppJobFloatingBar" aria-label="Background jobs">
        <span className="ppJobPulse" aria-hidden="true" />
        <div>
          <strong>{activeJobs.length} background job{activeJobs.length === 1 ? "" : "s"} running</strong>
          <p>{activeJobs.map((job) => `${job.name}: ${job.source}`).join(" | ")}</p>
        </div>
        <button type="button" onClick={toggleMinimized}>Minimize</button>
      </aside>
    );
  }

  return (
    <aside className="ppDevJobPanel" aria-label="Development job monitor">
      <div className="ppDevJobPanelHeader">
        <div>
          <span>Development jobs</span>
          <strong>{activeJobs.length} running / {recentJobs.length} recent</strong>
        </div>
        <button type="button" onClick={toggleMinimized}>Minimize</button>
      </div>

      <div className="ppDevJobPanelBody">
        <section>
          <h2>Active</h2>
          {activeJobs.length ? (
            activeJobs.map((job) => (
              <JobCard key={job.id} job={job} logs={groupedLogs.get(job.id) || []} now={now} />
            ))
          ) : (
            <p className="ppDevJobEmpty">No background jobs running.</p>
          )}
        </section>

        <section>
          <h2>Recent jobs</h2>
          <div className="ppDevJobList">
            {recentJobs.map((job) => (
              <div className="ppDevJobListRow" key={job.id}>
                <span className={`ppDevJobStatus ppDevJobStatus-${job.status.toLowerCase()}`}>{job.status}</span>
                <strong>{job.name}</strong>
                <small>{formatElapsed(job, now)} | {job.source}</small>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Logs</h2>
          <div className="ppDevLogList">
            {logs.length ? logs.slice(0, 24).map((log) => (
              <article className={`ppDevLog ppDevLog-${log.level}`} key={log.id}>
                <header>
                  <span>{log.level}</span>
                  <strong>{log.event}</strong>
                  <small>{formatTimestamp(log.createdAtIso)}</small>
                </header>
                <p>{log.message}</p>
                {log.data && <pre>{JSON.stringify(log.data, null, 2)}</pre>}
              </article>
            )) : (
              <p className="ppDevJobEmpty">No development logs recorded yet.</p>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function JobCard({ job, logs, now }) {
  return (
    <article className="ppDevJobCard">
      <header>
        <div>
          <strong>{job.name}</strong>
          <span>{job.status}</span>
        </div>
        <small>{formatElapsed(job, now)}</small>
      </header>
      <p>{job.source}</p>
      <dl>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(job.startedAtIso)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatTimestamp(job.updatedAtIso)}</dd>
        </div>
        <div>
          <dt>Logs</dt>
          <dd>{logs.length}</dd>
        </div>
      </dl>
    </article>
  );
}

function formatElapsed(job, now) {
  const start = new Date(job.startedAtIso || job.startedAt || Date.now()).getTime();
  const end = job.finishedAtIso ? new Date(job.finishedAtIso).getTime() : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return "0s";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
