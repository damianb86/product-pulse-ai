import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLocation, useRevalidator } from "react-router";

const JOB_STATUS_ACTIVE_POLL_MS = 4_000;
const JOB_STATUS_IDLE_POLL_MS = 15_000;

export function ProductPulseJobMonitor({ initialMonitor, developmentMode = false }) {
  const fetcher = useFetcher();
  const searchFetcher = useFetcher();
  const revalidator = useRevalidator();
  const location = useLocation();
  const [minimized, setMinimized] = useState(() => Boolean(developmentMode));
  const [activePopover, setActivePopover] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [dismissedFailedJobIds, setDismissedFailedJobIds] = useState(() => new Set());
  const [completedJobNotice, setCompletedJobNotice] = useState(null);
  const [now, setNow] = useState(null);
  const observedJobsRef = useRef(new Map());
  const fetcherStateRef = useRef(fetcher.state);
  const searchFetcherLoadRef = useRef(searchFetcher.load);
  const lastSearchQueryRef = useRef("");
  const topbarRef = useRef(null);
  const searchInputRef = useRef(null);
  const monitor = fetcher.data?.jobMonitor || initialMonitor || {};
  const activeJobs = useMemo(() => monitor.activeJobs || [], [monitor.activeJobs]);
  const recentJobs = useMemo(() => monitor.recentJobs || [], [monitor.recentJobs]);
  const logs = useMemo(() => monitor.logs || [], [monitor.logs]);
  const hasActiveJobs = activeJobs.length > 0;
  const failedJob = useMemo(
    () => recentJobs.find((job) => isUserVisibleFailedJob(job, now) && !dismissedFailedJobIds.has(job.id)) || null,
    [dismissedFailedJobIds, now, recentJobs],
  );
  const failureNotice = failedJob ? (
    <JobFailureNotice
      job={failedJob}
      onDismiss={() => setDismissedFailedJobIds((current) => {
        const next = new Set(current);
        next.add(failedJob.id);
        return next;
      })}
    />
  ) : null;
  const completionNotice = completedJobNotice ? (
    <JobCompletionNotice
      job={completedJobNotice}
      onDismiss={() => setCompletedJobNotice(null)}
    />
  ) : null;
  const selectedJob = useMemo(
    () => recentJobs.find((job) => job.id === selectedJobId) || activeJobs.find((job) => job.id === selectedJobId) || null,
    [activeJobs, recentJobs, selectedJobId],
  );
  const normalizedSearchQuery = searchQuery.trim();
  const visibleLogs = useMemo(
    () => (selectedJobId ? logs.filter((log) => log.jobId === selectedJobId) : logs),
    [logs, selectedJobId],
  );

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (fetcherStateRef.current === "idle") fetcher.load("/app/job-status");
    }, hasActiveJobs ? JOB_STATUS_ACTIVE_POLL_MS : JOB_STATUS_IDLE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetcher, hasActiveJobs]);

  useEffect(() => {
    fetcherStateRef.current = fetcher.state;
  }, [fetcher.state]);

  useEffect(() => {
    searchFetcherLoadRef.current = searchFetcher.load;
  }, [searchFetcher.load]);

  useEffect(() => {
    const currentJobs = new Map();
    [...recentJobs, ...activeJobs].forEach((job) => {
      if (job?.id) currentJobs.set(job.id, getJobRefreshSnapshot(job));
    });

    const finishedJobs = [];
    currentJobs.forEach((job, jobId) => {
      const previous = observedJobsRef.current.get(jobId);
      if (previous && isActiveJobStatus(previous.status) && isTerminalJobStatus(job.status)) {
        finishedJobs.push(job);
      }
    });

    const activeJobDisappeared = [...observedJobsRef.current.values()].some(
      (job) => isActiveJobStatus(job.status) && !currentJobs.has(job.id),
    );

    observedJobsRef.current = currentJobs;

    if (finishedJobs.length || activeJobDisappeared) {
      const completedProductDiagnosis = finishedJobs.find((job) => (
        job.kind === "product-diagnosis" && job.status === "Completed"
      ));
      if (completedProductDiagnosis) setCompletedJobNotice(completedProductDiagnosis);
      revalidator.revalidate();
    }
  }, [activeJobs, recentJobs, revalidator]);

  useEffect(() => {
    if (!completedJobNotice) return undefined;
    const timeout = window.setTimeout(() => setCompletedJobNotice(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [completedJobNotice]);

  useEffect(() => {
    setActivePopover(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!activePopover) return undefined;

    const handlePointerDown = (event) => {
      if (topbarRef.current?.contains(event.target)) return;
      setActivePopover(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setActivePopover(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePopover]);

  useEffect(() => {
    if (activePopover !== "search") return undefined;
    const timeout = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [activePopover]);

  useEffect(() => {
    if (activePopover !== "search" || normalizedSearchQuery.length < 2) {
      if (normalizedSearchQuery.length < 2) lastSearchQueryRef.current = "";
      return undefined;
    }
    if (lastSearchQueryRef.current === normalizedSearchQuery) return undefined;

    const timeout = window.setTimeout(() => {
      lastSearchQueryRef.current = normalizedSearchQuery;
      searchFetcherLoadRef.current(`/app/product-search?q=${encodeURIComponent(normalizedSearchQuery)}`);
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [activePopover, normalizedSearchQuery]);

  useEffect(() => {
    const handleQueuedJobs = (event) => {
      const jobs = Array.isArray(event.detail?.jobs)
        ? event.detail.jobs
        : [event.detail?.job].filter(Boolean);
      if (!jobs.length) return;

      const nextJobs = new Map(observedJobsRef.current);
      jobs.forEach((job) => {
        if (job?.id) nextJobs.set(job.id, getJobRefreshSnapshot(job));
      });
      observedJobsRef.current = nextJobs;

      if (fetcherStateRef.current === "idle") fetcher.load("/app/job-status");
      revalidator.revalidate();
    };

    window.addEventListener("productpulse:jobs-queued", handleQueuedJobs);
    return () => window.removeEventListener("productpulse:jobs-queued", handleQueuedJobs);
  }, [fetcher, revalidator]);

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
  const topbar = (
    <ProductPulseGlobalTopbar
      refProp={topbarRef}
      activePopover={activePopover}
      setActivePopover={setActivePopover}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      searchFetcher={searchFetcher}
      searchInputRef={searchInputRef}
      activeJobs={activeJobs}
      recentJobs={recentJobs}
      hasActiveJobs={hasActiveJobs}
      now={now}
    />
  );

  if (developmentMode && minimized) {
    return (
      <>
        {topbar}
        {failureNotice}
        {completionNotice}
        <button className="ppJobDockMinimized" type="button" onClick={toggleMinimized} aria-label="Open development job monitor">
          <span className={`ppJobDockPulse${hasActiveJobs ? " isRunning" : ""}`} />
          <strong>Dev jobs</strong>
          <span className="ppJobExpandIcon" aria-hidden="true" />
        </button>
      </>
    );
  }

  if (!developmentMode) {
    return (
      <>
        {topbar}
        {failureNotice}
        {completionNotice}
      </>
    );
  }

  return (
    <>
      {topbar}
      {failureNotice}
      {completionNotice}
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
                  <strong>{getJobTitle(job)}</strong>
                  <small>{formatElapsed(job, now)} | {getJobSubtitle(job)}</small>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="ppDevLogHeader">
              <h2>{selectedJob ? `Logs: ${getJobTitle(selectedJob)}` : "Logs"}</h2>
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

function ProductPulseGlobalTopbar({
  refProp,
  activePopover,
  setActivePopover,
  searchQuery,
  setSearchQuery,
  searchFetcher,
  searchInputRef,
  activeJobs,
  recentJobs,
  hasActiveJobs,
  now,
}) {
  const activeCount = activeJobs.length;
  const isSearchOpen = activePopover === "search";
  const isJobsOpen = activePopover === "jobs";

  return (
    <div className="ppGlobalTopbar" ref={refProp}>
      <div className="ppGlobalTopbarIconCluster" aria-label="Global actions">
        <div className="ppGlobalTopbarAction">
          <button
            className={`ppGlobalTopbarIconButton${isSearchOpen ? " isActive" : ""}`}
            type="button"
            aria-label="Search products"
            aria-expanded={isSearchOpen}
            aria-controls="pp-global-product-search"
            onClick={() => setActivePopover(isSearchOpen ? null : "search")}
          >
            <s-icon type="search" size="small"></s-icon>
          </button>
          {isSearchOpen ? (
            <ProductSearchPopover
              id="pp-global-product-search"
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchFetcher={searchFetcher}
              searchInputRef={searchInputRef}
              onClose={() => setActivePopover(null)}
            />
          ) : null}
        </div>

        <div className="ppGlobalTopbarAction">
          <button
            className={`ppGlobalTopbarIconButton ppGlobalTopbarJobsButton${isJobsOpen ? " isActive" : ""}${hasActiveJobs ? " isRunning" : ""}`}
            type="button"
            aria-label={activeCount ? `Background processes, ${activeCount} active` : "Background processes"}
            aria-expanded={isJobsOpen}
            aria-controls="pp-global-jobs"
            onClick={() => setActivePopover(isJobsOpen ? null : "jobs")}
          >
            <span className="ppGlobalTopbarIconWrap" aria-hidden="true">
              <s-icon type="refresh" size="small"></s-icon>
            </span>
            {activeCount ? <span className="ppGlobalTopbarBadge">{activeCount}</span> : null}
          </button>
          {isJobsOpen ? (
            <JobsPopover
              id="pp-global-jobs"
              activeJobs={activeJobs}
              recentJobs={recentJobs}
              now={now}
              onClose={() => setActivePopover(null)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProductSearchPopover({ id, searchQuery, setSearchQuery, searchFetcher, searchInputRef, onClose }) {
  const normalizedQuery = searchQuery.trim();
  const searchData = searchFetcher.data || {};
  const searchResults = searchData.query === normalizedQuery ? searchData.products || [] : [];
  const searchPending = searchFetcher.state !== "idle";
  const showResults = normalizedQuery.length >= 2;

  return (
    <div className="ppGlobalTopbarPopover ppGlobalTopbarSearchPopover" id={id} role="dialog" aria-label="Search products">
      <label className="ppGlobalTopbarSearchField">
        <span>Search products</span>
        <input
          ref={searchInputRef}
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Product title, handle, issue..."
          autoComplete="off"
        />
      </label>

      <div className="ppGlobalTopbarSearchResults" aria-live="polite">
        {!showResults ? (
          <p className="ppGlobalTopbarEmpty">Type 2 or more characters.</p>
        ) : searchPending && !searchResults.length ? (
          <p className="ppGlobalTopbarEmpty">Searching...</p>
        ) : searchResults.length ? (
          <ul>
            {searchResults.map((product) => (
              <li key={product.id || product.href}>
                <ProductSearchMedia product={product} />
                <span className="ppGlobalTopbarProductCopy">
                  <strong>{product.title}</strong>
                  <small>{getProductSearchSubtitle(product)}</small>
                </span>
                <Link className="ppGlobalTopbarOpenButton" to={product.href} onClick={onClose} aria-label={`Open ${product.title || "product"}`}>
                  <s-icon type="external" size="small"></s-icon>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ppGlobalTopbarEmpty">No products found.</p>
        )}
      </div>
    </div>
  );
}

function ProductSearchMedia({ product }) {
  if (product.imageUrl) {
    return (
      <img
        className="ppGlobalTopbarProductImage"
        src={product.imageUrl}
        alt={product.imageAlt || product.title || "Product image"}
        loading="lazy"
      />
    );
  }

  return (
    <span className="ppGlobalTopbarProductGlyph" aria-hidden="true">
      <s-icon type="product" size="small"></s-icon>
    </span>
  );
}

function getProductSearchSubtitle(product) {
  const parts = [];
  if (product.handle) parts.push(`/${product.handle}`);
  if (product.detail) {
    parts.push(product.detail);
  } else {
    const vendorAndType = [product.vendor, product.productType].filter(Boolean).join(" / ");
    if (vendorAndType) parts.push(vendorAndType);
    if (product.collection) parts.push(product.collection);
  }
  return parts.join(" \u00B7 ") || "ProductPulse product";
}

function JobsPopover({ id, activeJobs, recentJobs, now, onClose }) {
  const activeJobIds = useMemo(() => new Set(activeJobs.map((job) => job.id)), [activeJobs]);
  const pastJobs = useMemo(
    () => recentJobs.filter((job) => !activeJobIds.has(job.id)),
    [activeJobIds, recentJobs],
  );
  const runningCount = activeJobs.filter((job) => job.status === "Running").length;
  const queuedCount = activeJobs.filter((job) => job.status === "Queued").length;
  const summary = [
    runningCount ? `${runningCount} running` : null,
    queuedCount ? `${queuedCount} queued` : null,
  ].filter(Boolean).join(" / ");

  return (
    <div className="ppGlobalTopbarPopover ppGlobalTopbarJobsPopover" id={id} role="dialog" aria-label="Background processes">
      <header className="ppGlobalTopbarPopoverHeader">
        <strong>Background processes</strong>
        <span>{summary || "No active jobs"}</span>
      </header>

      <JobPopoverSection title="Current" jobs={activeJobs} emptyText="No active background processes." now={now} onClose={onClose} current />
      <JobPopoverSection title="History" jobs={pastJobs} emptyText="No recent jobs yet." now={now} onClose={onClose} />
      <button className="ppGlobalTopbarJobsFooter" type="button" onClick={onClose}>
        <span aria-hidden="true" className="ppGlobalTopbarJobsFooterIcon">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span>View all background processes</span>
        <s-icon type="chevron-right" size="small"></s-icon>
      </button>
    </div>
  );
}

function JobPopoverSection({ title, jobs, emptyText, now, onClose, current = false }) {
  return (
    <section className={`ppGlobalTopbarJobSection${current ? " isCurrent" : " isHistory"}`}>
      <h2>{title}</h2>
      {jobs.length ? (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <JobPopoverItem job={job} now={now} current={current} onClose={onClose} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="ppGlobalTopbarEmpty">{emptyText}</p>
      )}
    </section>
  );
}

function JobPopoverItem({ job, now, current = false, onClose }) {
  const statusKey = getJobStatusKey(job);
  const metaItems = getJobMetaItems(job, now, current);

  return (
    <article className={`ppGlobalTopbarJobItem ppGlobalTopbarJobItem-${statusKey}${current ? " isCurrent" : ""}`}>
      <span className={`ppGlobalTopbarJobStateIcon ppGlobalTopbarJobStateIcon-${statusKey}`} aria-hidden="true">
        <s-icon type={getJobStateIconType(statusKey)} size="small"></s-icon>
      </span>
      <div className="ppGlobalTopbarJobMain">
        <div className="ppGlobalTopbarJobTitleRow">
          <span className={`ppGlobalTopbarJobStatus ppGlobalTopbarJobStatus-${statusKey}`}>{job.status}</span>
          <strong>{getJobTitle(job)}</strong>
        </div>
        <small>{getJobSubtitle(job)}</small>
        <div className="ppGlobalTopbarJobMeta">
          {metaItems.map((item) => (
            <span key={`${job.id}-${item.label}`} className={`ppGlobalTopbarJobMetaItem ppGlobalTopbarJobMetaItem-${item.icon}`}>
              <s-icon type={item.icon === "credits" ? "product" : item.icon} size="small"></s-icon>
              {item.label}
            </span>
          ))}
        </div>
      </div>
      {job.productHref ? (
        <Link className="ppGlobalTopbarJobOpenButton" to={job.productHref} onClick={onClose} aria-label={`Open product for ${getJobTitle(job)}`}>
          <s-icon type="external" size="small"></s-icon>
        </Link>
      ) : null}
    </article>
  );
}

function getJobStatusKey(job) {
  return String(job.status || "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown";
}

function getJobStateIconType(statusKey) {
  if (statusKey === "completed") return "check-circle";
  if (statusKey === "failed") return "alert-circle";
  if (statusKey === "queued") return "clock";
  return "refresh";
}

function getJobMetaItems(job, now, current) {
  const showElapsed = current || job.status !== "Queued";
  return [
    { icon: "clock", label: getJobTimeMetaLabel(job) },
    { icon: "credits", label: getJobCreditLabel(job) },
    showElapsed ? { icon: "clock", label: formatElapsed(job, now) } : null,
  ].filter((item) => item?.label);
}

function getJobTimeMetaLabel(job) {
  const timestamp = job.finishedAtIso || job.executionStartedAtIso || job.startedAtIso || job.updatedAtIso;
  const time = formatJobClockTime(timestamp);
  if (job.status === "Completed") return `Completed ${time}`;
  if (job.status === "Failed") return `Failed ${time}`;
  if (job.status === "Queued") return `Queued ${time}`;
  return `Started ${time}`;
}

function getJobCreditLabel(job) {
  const credits = Number(job.creditsConsumed ?? job.credits ?? job.creditCost ?? (job.kind === "product-diagnosis" ? 1 : 0));
  if (!Number.isFinite(credits) || credits <= 0) return "";
  return `${credits} credit${credits === 1 ? "" : "s"}`;
}

function getJobRefreshSnapshot(job) {
  return {
    id: job.id,
    status: job.status,
    kind: job.kind,
    productTitle: job.productTitle || job.displayTitle || "",
    productHandle: job.productHandle || "",
    productHref: job.productHref || "",
    updatedAtIso: job.updatedAtIso || "",
    finishedAtIso: job.finishedAtIso || "",
  };
}

function isActiveJobStatus(status) {
  return status === "Queued" || status === "Running";
}

function isTerminalJobStatus(status) {
  return status === "Completed" || status === "Failed";
}

function JobCompletionNotice({ job, onDismiss }) {
  const href = job.productHref || (job.productHandle ? `/app/products/${job.productHandle}` : "/app/products");

  return (
    <aside className="ppJobCompletionNotice" role="status" aria-live="polite">
      <span aria-hidden="true">
        <s-icon type="wand" size="small"></s-icon>
      </span>
      <div>
        <strong>Deep analysis finished</strong>
        <p>{getJobTitle(job)} is ready to review.</p>
        <Link to={href} onClick={onDismiss}>
          Open product
          <s-icon type="chevron-right" size="small"></s-icon>
        </Link>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss completed job message">
        <s-icon type="x" size="small"></s-icon>
      </button>
    </aside>
  );
}

function JobFailureNotice({ job, onDismiss }) {
  const detail = getJobFailureDetail(job);

  return (
    <aside className="ppJobFailureNotice" role="alert" aria-live="assertive">
      <span aria-hidden="true">
        <s-icon type="alert-circle" size="small"></s-icon>
      </span>
      <div>
        <strong>{getJobTitle(job)} finished with an error</strong>
        <p>The background job could not be completed. Please try again later.</p>
        {detail && <p className="ppJobFailureDetail">{detail}</p>}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss failed job message">
        <s-icon type="x" size="small"></s-icon>
      </button>
    </aside>
  );
}

function JobCard({ job, logs, now }) {
  return (
    <article className="ppDevJobCard">
      <header>
        <div>
          <strong>{getJobTitle(job)}</strong>
          <span>{job.status}</span>
        </div>
        <small>{formatElapsed(job, now)}</small>
      </header>
      <p>{getJobSubtitle(job)}</p>
      <dl>
        <div>
          <dt>Started</dt>
          <dd>{job.status === "Queued" ? "Waiting" : formatTimestamp(job.executionStartedAtIso || job.startedAtIso)}</dd>
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
  if (job.status === "Queued") return "Queued";
  if (now === null && Number.isFinite(Number(job.elapsedMs))) {
    return formatDuration(Number(job.elapsedMs));
  }
  if (now === null) return job.status === "Running" ? "Running" : "0s";
  const start = new Date(job.executionStartedAtIso || job.startedAtIso || job.startedAt || now).getTime();
  const end = job.finishedAtIso ? new Date(job.finishedAtIso).getTime() : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return "0s";
  return formatDuration(end - start);
}

function formatDuration(durationMs) {
  const seconds = Math.max(0, Math.floor(Number(durationMs || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function getJobTitle(job) {
  return job.displayTitle || job.productTitle || job.name;
}

function getJobSubtitle(job) {
  return job.displaySubtitle || job.source || job.name;
}

function getJobFailureDetail(job) {
  const detail = job.errorMessage || (job.status === "Failed" ? job.source : "");
  if (!detail) return "";
  return truncateText(detail, 360);
}

function truncateText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function isUserVisibleFailedJob(job, now) {
  if (job.status !== "Failed") return false;
  if (now === null) return true;
  const finished = new Date(job.finishedAtIso || job.updatedAtIso || Date.now()).getTime();
  if (Number.isNaN(finished)) return true;
  return now - finished <= 10 * 60 * 1000;
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

function formatJobClockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
