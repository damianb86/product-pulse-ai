import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";

export function ProductPulseJobMonitor({ initialMonitor, developmentMode = false }) {
  const fetcher = useFetcher();
  const [minimized, setMinimized] = useState(() => Boolean(developmentMode));
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const monitor = fetcher.data?.jobMonitor || initialMonitor || {};
  const activeJobs = useMemo(() => monitor.activeJobs || [], [monitor.activeJobs]);
  const recentJobs = useMemo(() => monitor.recentJobs || [], [monitor.recentJobs]);
  const logs = useMemo(() => monitor.logs || [], [monitor.logs]);
  const hasActiveJobs = activeJobs.length > 0;
  const globalIndicator = hasActiveJobs ? <GlobalJobActivityIndicator jobs={activeJobs} now={now} /> : null;
  const selectedJob = useMemo(
    () => recentJobs.find((job) => job.id === selectedJobId) || activeJobs.find((job) => job.id === selectedJobId) || null,
    [activeJobs, recentJobs, selectedJobId],
  );
  const visibleLogs = useMemo(
    () => (selectedJobId ? logs.filter((log) => log.jobId === selectedJobId) : logs),
    [logs, selectedJobId],
  );

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

  useEffect(() => {
    if (!selectedJobId) return;
    const jobExists = recentJobs.some((job) => job.id === selectedJobId) || activeJobs.some((job) => job.id === selectedJobId);
    if (!jobExists) setSelectedJobId(null);
  }, [activeJobs, recentJobs, selectedJobId]);

  const toggleMinimized = () => setMinimized((current) => !current);

  if (!developmentMode && !hasActiveJobs) return null;

  if (developmentMode && minimized) {
    return (
      <>
        {globalIndicator}
        <button className="ppJobDockMinimized" type="button" onClick={toggleMinimized} aria-label="Open development job monitor">
          <span className={`ppJobDockPulse${hasActiveJobs ? " isRunning" : ""}`} />
          <strong>Dev jobs</strong>
          <span className="ppJobExpandIcon" aria-hidden="true" />
        </button>
      </>
    );
  }

  if (!developmentMode) {
    return globalIndicator;
  }

  return (
    <>
      {globalIndicator}
      <aside className="ppDevJobPanel" aria-label="Development job monitor">
        <div className="ppDevJobPanelHeader">
          <div>
            <span>Development jobs</span>
            <strong>{activeJobs.length} running / {recentJobs.length} recent</strong>
          </div>
          <button className="ppJobMinimizeButton" type="button" onClick={toggleMinimized} aria-label="Minimize development job monitor" title="Minimize">
            <span aria-hidden="true" />
          </button>
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
                <button
                  className={`ppDevJobListRow${selectedJobId === job.id ? " isSelected" : ""}`}
                  type="button"
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  aria-pressed={selectedJobId === job.id}
                >
                  <span className={`ppDevJobStatus ppDevJobStatus-${job.status.toLowerCase()}`}>{job.status}</span>
                  <strong>{job.name}</strong>
                  <small>{formatElapsed(job, now)} | {job.source}</small>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="ppDevLogHeader">
              <h2>{selectedJob ? `Logs: ${selectedJob.name}` : "Logs"}</h2>
              {selectedJob && (
                <button type="button" onClick={() => setSelectedJobId(null)}>
                  All logs
                </button>
              )}
            </div>
            <div className="ppDevLogList">
              {visibleLogs.length ? visibleLogs.slice(0, 24).map((log) => (
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
                <p className="ppDevJobEmpty">{selectedJob ? "No logs recorded for this job yet." : "No development logs recorded yet."}</p>
              )}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

function GlobalJobActivityIndicator({ jobs, now }) {
  const runningCount = jobs.filter((job) => job.status === "Running").length;
  const queuedCount = jobs.filter((job) => job.status === "Queued").length;
  const totalCount = jobs.length;
  const summary = [
    runningCount ? `${runningCount} running` : null,
    queuedCount ? `${queuedCount} queued` : null,
  ].filter(Boolean).join(" / ");

  return (
    <div className="ppGlobalJobIndicator" role="status" aria-live="polite">
      <button className="ppGlobalJobButton" type="button" aria-label={`${totalCount} background process${totalCount === 1 ? "" : "es"} active`}>
        <span className="ppGlobalJobGlyph" aria-hidden="true">
          <s-icon type="refresh" size="small"></s-icon>
        </span>
        <strong>{totalCount}</strong>
        <span>Jobs</span>
      </button>
      <div className="ppGlobalJobPopover" role="tooltip">
        <header>
          <strong>Background processes</strong>
          <span>{summary || `${totalCount} active`}</span>
        </header>
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <span className={`ppGlobalJobStatus ppGlobalJobStatus-${job.status.toLowerCase()}`}>{job.status}</span>
              <div>
                <strong>{job.name}</strong>
                <small>{job.source}</small>
              </div>
              <em>{formatElapsed(job, now)}</em>
            </li>
          ))}
        </ul>
      </div>
    </div>
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
