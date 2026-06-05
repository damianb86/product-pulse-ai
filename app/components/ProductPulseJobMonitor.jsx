import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLocation, useRevalidator } from "react-router";
import { buildEmbeddedAppPath } from "../lib/product-pulse-app-paths";

const JOB_STATUS_MIN_REFRESH_MS = 10_000;
const JOB_STATUS_ACTIVE_POLL_MS = 10_000;
const JOB_STATUS_IDLE_POLL_MS = 180_000;
const JOB_STATUS_INITIAL_LOAD_MS = 30_000;
const CREDIT_SUMMARY_REFRESH_MS = 60_000;

export function ProductPulseJobMonitor({ initialMonitor, developmentMode = false }) {
  const fetcher = useFetcher();
  const cancelFetcher = useFetcher();
  const searchFetcher = useFetcher();
  const creditFetcher = useFetcher();
  const revalidator = useRevalidator();
  const location = useLocation();
  const [minimized, setMinimized] = useState(() => Boolean(developmentMode));
  const [activePopover, setActivePopover] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [completedJobNotice, setCompletedJobNotice] = useState(null);
  const [failedJobNotice, setFailedJobNotice] = useState(null);
  const [now, setNow] = useState(null);
  const observedJobsRef = useRef(new Map());
  const announcedFailedJobIdsRef = useRef(new Set());
  const fetcherStateRef = useRef(fetcher.state);
  const searchFetcherLoadRef = useRef(searchFetcher.load);
  const creditFetcherLoadRef = useRef(creditFetcher.load);
  const creditFetcherStateRef = useRef(creditFetcher.state);
  const lastJobStatusLoadAtRef = useRef(0);
  const lastCreditSummaryLoadAtRef = useRef(0);
  const pendingJobStatusLoadRef = useRef(null);
  const lastSearchQueryRef = useRef("");
  const topbarRef = useRef(null);
  const searchInputRef = useRef(null);
  const [monitorSnapshot, setMonitorSnapshot] = useState(() => initialMonitor || {});
  const monitor = monitorSnapshot || {};
  const activeJobs = useMemo(() => monitor.activeJobs || [], [monitor.activeJobs]);
  const recentJobs = useMemo(() => monitor.recentJobs || [], [monitor.recentJobs]);
  const logs = useMemo(() => monitor.logs || [], [monitor.logs]);
  const creditSummary = creditFetcher.data?.pointSummary || null;
  const pointSummary = creditSummary || monitor.pointSummary || initialMonitor?.pointSummary || null;
  const pointBalance = pointSummary?.balance || creditFetcher.data?.pointBalance || monitor.pointBalance || initialMonitor?.pointBalance || null;
  const activeJobCount = Number(monitor.activeJobCount ?? initialMonitor?.activeJobCount ?? activeJobs.length) || 0;
  const hasActiveJobs = activeJobCount > 0;
  const buildAppPath = useCallback((path) => buildEmbeddedAppPath(location.pathname, path), [location.pathname]);
  const jobStatusPath = buildAppPath("/app/job-status");
  const creditSummaryPath = buildAppPath("/app/credits-summary");
  const pendingCancelJobId = cancelFetcher.state !== "idle"
    ? String(cancelFetcher.formData?.get("jobId") || "")
    : "";
  const failureNotice = failedJobNotice ? (
      <JobFailureNotice
        job={failedJobNotice}
        onDismiss={() => setFailedJobNotice(null)}
        buildAppPath={buildAppPath}
      />
  ) : null;
  const completionNotice = completedJobNotice ? (
      <JobCompletionNotice
        job={completedJobNotice}
        onDismiss={() => setCompletedJobNotice(null)}
        buildAppPath={buildAppPath}
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
  const requestJobStatusLoad = useCallback((options = {}) => {
    const { allowHidden = false, force = false, scope = "summary" } = options;
    if (!allowHidden && document.hidden) return;
    if (fetcherStateRef.current !== "idle") return;

    const elapsedMs = Date.now() - lastJobStatusLoadAtRef.current;
    const remainingMs = force ? 0 : Math.max(0, JOB_STATUS_MIN_REFRESH_MS - elapsedMs);
    if (remainingMs > 0) {
      if (!pendingJobStatusLoadRef.current) {
        pendingJobStatusLoadRef.current = window.setTimeout(() => {
          pendingJobStatusLoadRef.current = null;
          requestJobStatusLoad(options);
        }, remainingMs);
      }
      return;
    }

    lastJobStatusLoadAtRef.current = Date.now();
    fetcher.load(buildJobStatusRequestPath(jobStatusPath, scope));
  }, [fetcher, jobStatusPath]);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!fetcher.data?.jobMonitor) return;
    setMonitorSnapshot((current) => mergeJobMonitorSnapshot(current, fetcher.data.jobMonitor));
  }, [fetcher.data]);

  useEffect(() => {
    if (initialMonitor || document.hidden) return undefined;
    const timeout = window.setTimeout(() => {
      requestJobStatusLoad();
    }, JOB_STATUS_INITIAL_LOAD_MS);
    return () => window.clearTimeout(timeout);
  }, [initialMonitor, requestJobStatusLoad]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      requestJobStatusLoad();
    }, hasActiveJobs ? JOB_STATUS_ACTIVE_POLL_MS : JOB_STATUS_IDLE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [hasActiveJobs, requestJobStatusLoad]);

  useEffect(() => () => {
    if (pendingJobStatusLoadRef.current) {
      window.clearTimeout(pendingJobStatusLoadRef.current);
      pendingJobStatusLoadRef.current = null;
    }
  }, [jobStatusPath]);

  useEffect(() => {
    fetcherStateRef.current = fetcher.state;
  }, [fetcher.state]);

  useEffect(() => {
    searchFetcherLoadRef.current = searchFetcher.load;
  }, [searchFetcher.load]);

  useEffect(() => {
    creditFetcherLoadRef.current = creditFetcher.load;
  }, [creditFetcher.load]);

  useEffect(() => {
    creditFetcherStateRef.current = creditFetcher.state;
  }, [creditFetcher.state]);

  useEffect(() => {
    if (activePopover !== "credits") return;
    if (creditFetcherStateRef.current !== "idle") return;
    const elapsedMs = Date.now() - lastCreditSummaryLoadAtRef.current;
    if (creditFetcher.data?.pointSummary && elapsedMs < CREDIT_SUMMARY_REFRESH_MS) return;
    lastCreditSummaryLoadAtRef.current = Date.now();
    creditFetcherLoadRef.current(creditSummaryPath);
  }, [activePopover, creditFetcher.data, creditSummaryPath]);

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
      if (finishedJobs.length) {
        dispatchProductPulseJobsFinishedEvent(finishedJobs);
      }
      const completedAnalysisJob = finishedJobs.find((job) => isCompletionNoticeJob(job));
      const failedJob = finishedJobs.find((job) => (
        job.status === "Failed" && !announcedFailedJobIdsRef.current.has(job.id)
      ));
      if (completedAnalysisJob) setCompletedJobNotice(completedAnalysisJob);
      if (failedJob) {
        announcedFailedJobIdsRef.current.add(failedJob.id);
        setFailedJobNotice(failedJob);
      }
      revalidator.revalidate();
    }
  }, [activeJobs, recentJobs, revalidator]);

  useEffect(() => {
    if (!completedJobNotice) return undefined;
    if (completedJobNotice.kind === "product-diagnosis" && document.body.classList.contains("ppWizardActive")) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCompletedJobNotice(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [completedJobNotice]);

  useEffect(() => {
    if (cancelFetcher.state !== "idle" || cancelFetcher.data?.status !== "success") return;
    requestJobStatusLoad({ force: true });
    revalidator.revalidate();
  }, [cancelFetcher.data, cancelFetcher.state, requestJobStatusLoad, revalidator]);

  useEffect(() => {
    if (completedJobNotice?.kind !== "product-diagnosis") return;
    dispatchProductPulseWizardJobEvent({
      type: "deep-scan-completed",
      job: completedJobNotice,
    });
  }, [completedJobNotice]);

  useEffect(() => {
    setActivePopover(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (activePopover !== "jobs") return;
    requestJobStatusLoad({ force: true, scope: "popover" });
  }, [activePopover, requestJobStatusLoad]);

  useEffect(() => {
    const handleWizardOpenBackgroundProcesses = () => {
      setActivePopover("jobs");
    };

    window.addEventListener("productpulse:wizard-open-background-processes", handleWizardOpenBackgroundProcesses);
    return () => window.removeEventListener("productpulse:wizard-open-background-processes", handleWizardOpenBackgroundProcesses);
  }, []);

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
      searchFetcherLoadRef.current(buildAppPath(`/app/product-search?q=${encodeURIComponent(normalizedSearchQuery)}`));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [activePopover, buildAppPath, normalizedSearchQuery]);

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

      requestJobStatusLoad({ force: true });
      revalidator.revalidate();
    };

    window.addEventListener("productpulse:jobs-queued", handleQueuedJobs);
    return () => window.removeEventListener("productpulse:jobs-queued", handleQueuedJobs);
  }, [requestJobStatusLoad, revalidator]);

  useEffect(() => {
    if (!hasActiveJobs && fetcher.state === "idle" && !fetcher.data) {
      requestJobStatusLoad();
    }
  }, [fetcher.data, fetcher.state, hasActiveJobs, requestJobStatusLoad]);

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
      activeJobCount={activeJobCount}
      recentJobs={recentJobs}
      hasActiveJobs={hasActiveJobs}
      pointBalance={pointBalance}
      pointSummary={pointSummary}
      creditsLoading={activePopover === "credits" && creditFetcher.state !== "idle"}
      now={now}
      pendingCancelJobId={pendingCancelJobId}
      onCancelJob={(job) => {
        if (!job?.id) return;
        const confirmed = window.confirm(
          `Cancel ${getJobTitle(job)}?\n\nThis will stop tracking this queued or running background process. If credits were already consumed for this job, they will not be automatically refunded.`,
        );
        if (!confirmed) return;
        const formData = new FormData();
        formData.set("_action", "cancel-background-job");
        formData.set("jobId", job.id);
        cancelFetcher.submit(formData, { method: "post", action: jobStatusPath });
      }}
      buildAppPath={buildAppPath}
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
            <strong>{activeJobCount} active / {recentJobs.length} recent</strong>
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
  activeJobCount,
  recentJobs,
  hasActiveJobs,
  pointBalance,
  pointSummary,
  creditsLoading,
  now,
  pendingCancelJobId,
  onCancelJob,
  buildAppPath,
}) {
  const activeCount = Number(activeJobCount ?? activeJobs.length) || 0;
  const isSearchOpen = activePopover === "search";
  const isJobsOpen = activePopover === "jobs";
  const isCreditsOpen = activePopover === "credits";
  const pointLabel = formatPointBalanceLabel(pointBalance);
  const creditsButtonLabel = hasPointBalance(pointBalance) ? `${pointLabel} Credits available` : "Credits";

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
              buildAppPath={buildAppPath}
            />
          ) : null}
        </div>

        <div className="ppGlobalTopbarAction">
          <button
            className={`ppGlobalTopbarIconButton ppGlobalTopbarJobsButton${isJobsOpen ? " isActive" : ""}${hasActiveJobs ? " isRunning" : ""}`}
            data-pp-background-process-button
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
              activeJobCount={activeCount}
              recentJobs={recentJobs}
              now={now}
              onClose={() => setActivePopover(null)}
              pendingCancelJobId={pendingCancelJobId}
              onCancelJob={onCancelJob}
              buildAppPath={buildAppPath}
            />
          ) : null}
        </div>

        <div className="ppGlobalTopbarAction">
          <button
            className={`ppGlobalTopbarPoints${isCreditsOpen ? " isActive" : ""}`}
            type="button"
            aria-label={creditsButtonLabel}
            aria-expanded={isCreditsOpen}
            aria-controls="pp-global-credits"
            title={creditsButtonLabel}
            onClick={() => setActivePopover(isCreditsOpen ? null : "credits")}
          >
            <span className="ppGlobalTopbarWalletIcon" aria-hidden="true">
              <span />
            </span>
            <strong>{pointLabel}</strong>
          </button>
          {isCreditsOpen ? (
            <CreditsPopover id="pp-global-credits" pointBalance={pointBalance} pointSummary={pointSummary} loading={creditsLoading} buildAppPath={buildAppPath} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CreditsPopover({ id, pointSummary, pointBalance, loading = false, buildAppPath = defaultBuildAppPath }) {
  const summary = normalizeCreditPopoverSummary(pointSummary, pointBalance);
  const activity = summary.activity;

  return (
    <div className="ppGlobalTopbarPopover ppGlobalTopbarCreditsPopover" id={id} role="dialog" aria-label="Credit details">
      <section className="ppCreditsSummaryPanel" aria-label="Credit summary">
        <div className="ppCreditsSummaryMetric">
          <span>Total remaining</span>
          <strong>{summary.remainingLabel}</strong>
          <small>Credits</small>
        </div>
        <div className="ppCreditsSummaryMetric">
          <span>Current plan</span>
          <strong>{summary.plan.name}</strong>
          <small>{summary.plan.renewalLabel}</small>
        </div>
        <div className="ppCreditsSummaryMetric ppCreditsUsageMetric">
          <span>Usage this period</span>
          <strong><b>{summary.usage.usedLabel}</b> / {summary.usage.totalLabel} credits used</strong>
          <div className="ppCreditsProgress" aria-hidden="true">
            <span style={{ width: `${summary.usage.progressPercent}%` }} />
          </div>
          <small>{summary.usage.percentLabel}</small>
        </div>
      </section>

      <section className="ppCreditsActivity" aria-label="Recent credit activity">
        <h2>Recent credit activity</h2>
        {loading && !pointSummary ? (
          <p className="ppCreditsActivityEmpty">Loading credit activity...</p>
        ) : activity.length ? (
          <ul>
            {activity.map((item) => (
              <li key={item.id}>
                <span className="ppCreditsActivityIcon" aria-hidden="true">
                  <s-icon type={getCreditActivityIcon(item)} size="small"></s-icon>
                </span>
                <span className="ppCreditsActivityCopy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="ppCreditsActivityAmount">
                  <strong>{item.amountLabel}</strong>
                  <small>{item.timeLabel}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ppCreditsActivityEmpty">No recent credit activity.</p>
        )}
      </section>

      <footer className="ppCreditsFooter">
        <Link className="ppCreditsBuyLink" to={buildAppPath("/app/plans-and-credits")}>
          <span className="ppCreditsBuyIcon" aria-hidden="true">
            <s-icon type="product" size="small"></s-icon>
          </span>
          Review credits
        </Link>
      </footer>
    </div>
  );
}

function normalizeCreditPopoverSummary(pointSummary, pointBalance) {
  const balance = pointSummary?.balance || pointBalance || {};
  const remaining = normalizeCreditValue(balance.available ?? balance.balance);
  const planAllowance = normalizeCreditValue(pointSummary?.plan?.allowance ?? pointSummary?.usage?.total, 100);
  const used = normalizeCreditValue(pointSummary?.usage?.used, Math.max(0, planAllowance - remaining));
  const percent = planAllowance > 0 ? Math.round((used / planAllowance) * 100) : 0;
  const progressPercent = normalizeCreditValue(
    pointSummary?.usage?.progressPercent,
    Math.max(0, Math.min(100, percent)),
  );

  return {
    remainingLabel: formatCompactCreditValue(remaining),
    plan: {
      name: pointSummary?.plan?.name || "Free plan",
      renewalLabel: pointSummary?.plan?.renewalLabel || "Does not renew",
    },
    usage: {
      usedLabel: pointSummary?.usage?.usedLabel || formatCompactCreditValue(used),
      totalLabel: pointSummary?.usage?.totalLabel || formatCompactCreditValue(planAllowance),
      percentLabel: pointSummary?.usage?.percentLabel || `${Math.max(0, percent)}% used`,
      progressPercent: Math.max(0, Math.min(100, progressPercent)),
    },
    activity: normalizeCreditActivity(pointSummary?.activity),
  };
}

function normalizeCreditActivity(activity) {
  if (!Array.isArray(activity)) return [];
  return activity.map((item, index) => ({
    id: item.id || `${item.title || "diagnosis-credit-activity"}-${index}`,
    icon: item.icon || "product",
    title: item.title || "Credit activity",
    detail: item.detail || "Credits",
    amountLabel: item.amountLabel || formatSignedCreditValue(item.amount),
    timeLabel: item.timeLabel || item.time || "",
  }));
}

function getCreditActivityIcon(item) {
  if (["search", "product", "wand", "clock"].includes(item?.icon)) return item.icon;
  return "product";
}

function normalizeCreditValue(value, fallback = 0) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? number : Number(fallback);
  return Math.round(Math.max(0, Number.isFinite(normalized) ? normalized : 0) * 10) / 10;
}

function formatCompactCreditValue(value) {
  const rounded = normalizeCreditValue(value);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatSignedCreditValue(value) {
  const number = Number(value);
  const amount = normalizeCreditValue(Math.abs(Number.isFinite(number) ? number : 0));
  const sign = number < 0 ? "-" : "+";
  return `${sign}${formatCompactCreditValue(amount)} credit${amount === 1 ? "" : "s"}`;
}

function ProductSearchPopover({ id, searchQuery, setSearchQuery, searchFetcher, searchInputRef, onClose, buildAppPath = defaultBuildAppPath }) {
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
                <Link className="ppGlobalTopbarOpenButton" to={buildAppPath(product.href)} onClick={onClose} aria-label={`Open ${product.title || "product"}`}>
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

function JobsPopover({ id, activeJobs, activeJobCount, recentJobs, now, onClose, pendingCancelJobId, onCancelJob, buildAppPath = defaultBuildAppPath }) {
  const activeJobIds = useMemo(() => new Set(activeJobs.map((job) => job.id)), [activeJobs]);
  const pastJobs = useMemo(
    () => recentJobs.filter((job) => !activeJobIds.has(job.id)).slice(0, 6),
    [activeJobIds, recentJobs],
  );
  const runningCount = activeJobs.filter((job) => job.status === "Running").length;
  const queuedCount = activeJobs.filter((job) => job.status === "Queued").length;
  const totalActiveCount = Number(activeJobCount ?? activeJobs.length) || 0;
  const summary = [
    runningCount ? `${runningCount} running` : null,
    queuedCount ? `${queuedCount} queued` : null,
    totalActiveCount > activeJobs.length ? `${totalActiveCount} active total` : null,
  ].filter(Boolean).join(" / ");

  return (
    <div
      className="ppGlobalTopbarPopover ppGlobalTopbarJobsPopover"
      data-pp-background-process-popover
      id={id}
      role="dialog"
      aria-label="Background processes"
    >
      <header className="ppGlobalTopbarPopoverHeader">
        <strong>Background processes</strong>
        <span>{summary || "No active jobs"}</span>
      </header>

      <JobPopoverSection
        title="Current"
        jobs={activeJobs}
        emptyText="No active background processes."
        now={now}
        onClose={onClose}
        pendingCancelJobId={pendingCancelJobId}
        onCancelJob={onCancelJob}
        buildAppPath={buildAppPath}
        current
      />
      <JobPopoverSection title="History" jobs={pastJobs} emptyText="No recent jobs yet." now={now} onClose={onClose} buildAppPath={buildAppPath} />
      <Link className="ppGlobalTopbarJobsFooter" to={buildAppPath("/app/background-processes")} onClick={onClose}>
        <span aria-hidden="true" className="ppGlobalTopbarJobsFooterIcon">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span>View all background processes</span>
        <s-icon type="chevron-right" size="small"></s-icon>
      </Link>
    </div>
  );
}

function JobPopoverSection({ title, jobs, emptyText, now, onClose, current = false, pendingCancelJobId = "", onCancelJob, buildAppPath = defaultBuildAppPath }) {
  return (
    <section className={`ppGlobalTopbarJobSection${current ? " isCurrent" : " isHistory"}`}>
      <h2>{title}</h2>
      {jobs.length ? (
        <ul>
          {jobs.map((job) => (
            <li key={job.id}>
              <JobPopoverItem
                job={job}
                now={now}
                current={current}
                onClose={onClose}
                cancelPending={pendingCancelJobId === job.id}
                onCancelJob={onCancelJob}
                buildAppPath={buildAppPath}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="ppGlobalTopbarEmpty">{emptyText}</p>
      )}
    </section>
  );
}

function JobPopoverItem({ job, now, current = false, onClose, cancelPending = false, onCancelJob, buildAppPath = defaultBuildAppPath }) {
  const statusKey = getJobStatusKey(job);
  const metaItems = getJobMetaItems(job, now, current);
  const canCancel = current && isActiveJobStatus(job.status) && typeof onCancelJob === "function";

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
              <s-icon type={item.icon === "points" ? "product" : item.icon} size="small"></s-icon>
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="ppGlobalTopbarJobItemActions">
        {canCancel ? (
          <button
            className="ppGlobalTopbarJobCancelButton"
            type="button"
            aria-label={`Cancel ${getJobTitle(job)}`}
            title="Cancel job"
            disabled={cancelPending}
            onClick={() => onCancelJob(job)}
          >
            <s-icon type="x" size="small"></s-icon>
          </button>
        ) : null}
        {job.productHref ? (
          <Link className="ppGlobalTopbarJobOpenButton" to={buildAppPath(job.productHref)} onClick={onClose} aria-label={`Open product for ${getJobTitle(job)}`}>
            <s-icon type="external" size="small"></s-icon>
          </Link>
        ) : null}
      </div>
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
    { icon: "points", label: getJobCreditLabel(job) },
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
  const points = Number(job.pointsConsumed ?? job.creditsConsumed ?? job.credits ?? job.creditCost ?? (job.kind === "product-diagnosis" ? 1 : 0));
  if (!Number.isFinite(points) || points <= 0) return "";
  return `${formatPointBalanceLabel({ available: points })} credit${points === 1 ? "" : "s"}`;
}

function formatPointBalanceLabel(pointBalance) {
  if (!hasPointBalance(pointBalance)) return "Credits";
  const rawValue = typeof pointBalance === "number"
    ? pointBalance
    : pointBalance?.available ?? pointBalance?.balance ?? 0;
  const value = Number(rawValue);
  const normalized = Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  return normalized.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function hasPointBalance(pointBalance) {
  if (typeof pointBalance === "number") return Number.isFinite(pointBalance);
  return pointBalance?.available !== undefined || pointBalance?.balance !== undefined;
}

function getJobRefreshSnapshot(job) {
  return {
    id: job.id,
    status: job.status,
    kind: job.kind,
    productTitle: job.productTitle || job.displayTitle || "",
    productHandle: job.productHandle || "",
    productHref: job.productHref || "",
    imageUrl: getJobNoticeImageUrl(job),
    imageAlt: getJobNoticeImageAlt(job),
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

function isCompletionNoticeJob(job) {
  return job?.status === "Completed" && ["product-diagnosis", "fast-product-scan"].includes(job.kind);
}

function JobCompletionNotice({ job, onDismiss, buildAppPath = defaultBuildAppPath }) {
  return (
    <JobNotice
      job={job}
      tone="success"
      title={getJobCompletionNoticeTitle(job)}
      message={getJobCompletionNoticeMessage(job)}
      role="status"
      ariaLive="polite"
      onDismiss={onDismiss}
      buildAppPath={buildAppPath}
    />
  );
}

function JobFailureNotice({ job, onDismiss, buildAppPath = defaultBuildAppPath }) {
  const detail = getJobFailureDetail(job);

  return (
    <JobNotice
      job={job}
      tone="critical"
      title={getJobFailureNoticeTitle(job)}
      message={getJobFailureNoticeMessage(job)}
      detail={detail}
      role="alert"
      ariaLive="assertive"
      onDismiss={onDismiss}
      buildAppPath={buildAppPath}
    />
  );
}

function JobNotice({ job, tone, title, message, detail, role, ariaLive, onDismiss, buildAppPath = defaultBuildAppPath }) {
  const action = getJobNoticeAction(job);
  const actionHref = buildAppPath(action.href);
  const isSuccess = tone === "success";
  const isProductDiagnosisCompletion = isSuccess && job?.kind === "product-diagnosis";
  const handleActionClick = () => {
    if (isProductDiagnosisCompletion) {
      dispatchProductPulseWizardJobEvent({
        type: "deep-scan-product-opened",
        job,
        href: actionHref,
      });
    }
    onDismiss();
  };

  return (
    <aside
      className={`ppJobNotice ppJobNotice-${tone} ${isSuccess ? "ppJobCompletionNotice" : "ppJobFailureNotice"}`}
      role={role}
      aria-live={ariaLive}
      data-pp-job-completion-notice={isSuccess ? job?.kind : undefined}
      data-pp-job-product-href={isProductDiagnosisCompletion ? actionHref : undefined}
    >
      <JobNoticeMedia job={job} tone={tone} />
      <span className="ppJobNoticeStatusIcon" aria-hidden="true">
        <s-icon type={isSuccess ? "check" : "alert-circle"} size="base"></s-icon>
      </span>
      <div className="ppJobNoticeCopy">
        <strong>{title}</strong>
        <p>{message}</p>
        {detail && <p className="ppJobNoticeDetail">{detail}</p>}
      </div>
      <Link
        className="ppJobNoticeAction"
        to={actionHref}
        onClick={handleActionClick}
        data-pp-job-completion-open-product={isProductDiagnosisCompletion ? "true" : undefined}
      >
        {action.label}
        <s-icon type="chevron-right" size="base"></s-icon>
      </Link>
      <button className="ppJobNoticeDismiss" type="button" onClick={onDismiss} aria-label={isSuccess ? "Dismiss completed job message" : "Dismiss failed job message"}>
        <s-icon type="x" size="base"></s-icon>
      </button>
    </aside>
  );
}

function dispatchProductPulseWizardJobEvent(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("productpulse:wizard", { detail }));
}

function dispatchProductPulseJobsFinishedEvent(jobs) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("productpulse:jobs-finished", { detail: { jobs } }));
}

function JobNoticeMedia({ job, tone }) {
  const imageUrl = getJobNoticeImageUrl(job);
  const imageAlt = getJobNoticeImageAlt(job);

  if (imageUrl) {
    return (
      <span className="ppJobNoticeMedia">
        <img src={imageUrl} alt={imageAlt} />
      </span>
    );
  }

  return (
    <span className={`ppJobNoticeMedia ppJobNoticeMediaFallback ppJobNoticeMediaFallback-${tone}`} aria-hidden="true">
      <s-icon type={job?.kind === "fast-product-scan" ? "search" : "product"} size="base"></s-icon>
    </span>
  );
}

function getJobNoticeImageUrl(job = {}) {
  const candidates = [
    job.imageUrl,
    job.productImageUrl,
    job.featuredImageUrl,
    typeof job.image === "string" ? job.image : job.image?.url,
    job.featuredImage?.url,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function getJobNoticeImageAlt(job = {}) {
  const candidates = [
    job.imageAlt,
    job.productImageAlt,
    job.featuredImageAlt,
    job.image?.altText,
    job.featuredImage?.altText,
    job.productTitle,
    job.displayTitle,
    getJobTitle(job),
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "Product image";
}

function getJobNoticeAction(job) {
  if (job?.kind === "fast-product-scan") {
    return { href: "/app/products", label: "Open products" };
  }
  const href = job?.productHref || (job?.productHandle ? `/app/products/${job.productHandle}` : "/app/background-processes");
  return { href, label: href === "/app/background-processes" ? "View job" : "Open product" };
}

function buildJobStatusRequestPath(path, scope) {
  const normalizedScope = scope === "popover" ? "popover" : "summary";
  return `${path}${path.includes("?") ? "&" : "?"}scope=${normalizedScope}`;
}

function mergeJobMonitorSnapshot(current = {}, incoming = {}) {
  if (!incoming || typeof incoming !== "object") return current || {};
  return {
    ...current,
    ...incoming,
    activeJobs: Array.isArray(incoming.activeJobs) ? incoming.activeJobs : current.activeJobs || [],
    recentJobs: incoming.recentJobsLoaded !== false && Array.isArray(incoming.recentJobs)
      ? incoming.recentJobs
      : current.recentJobs || [],
    logs: incoming.logsLoaded !== false && Array.isArray(incoming.logs)
      ? incoming.logs
      : current.logs || [],
    pointSummary: incoming.pointSummaryLoaded !== false && incoming.pointSummary !== undefined
      ? incoming.pointSummary || null
      : current.pointSummary || null,
    pointBalance: incoming.pointSummaryLoaded !== false && (incoming.pointBalance !== undefined || incoming.pointSummary !== undefined)
      ? incoming.pointBalance || incoming.pointSummary?.balance || null
      : current.pointBalance || current.pointSummary?.balance || null,
  };
}

function defaultBuildAppPath(path) {
  return path;
}

function getJobCompletionNoticeTitle(job) {
  if (job?.kind === "fast-product-scan") return "Catalog Scan finished";
  return "Product Diagnosis finished";
}

function getJobCompletionNoticeMessage(job) {
  if (job?.kind === "fast-product-scan") return "Your product scan is ready to review.";
  return `${getJobTitle(job)} is ready to review.`;
}

function getJobFailureNoticeTitle(job) {
  if (job?.kind === "fast-product-scan") return "Catalog Scan failed";
  if (job?.kind === "product-diagnosis") return "Product Diagnosis failed";
  return `${getJobTitle(job)} finished with an error`;
}

function getJobFailureNoticeMessage(job) {
  if (job?.kind === "fast-product-scan") return "ProductPulse could not finish the quick product scan.";
  if (job?.kind === "product-diagnosis") return `${getJobTitle(job)} could not be analyzed.`;
  return "The background job could not be completed. Please try again later.";
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
