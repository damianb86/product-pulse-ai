export function productPulseClassNames(...values) {
  return values
    .flatMap((value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === "object") {
        return Object.entries(value)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([className]) => className);
      }
      return [value];
    })
    .filter(Boolean)
    .join(" ");
}

export function AppPage({ children, className = "", label = "", title = "", titleId = "" }) {
  const labelProps = titleId
    ? { "aria-labelledby": titleId }
    : label
      ? { "aria-label": label }
      : {};

  return (
    <main className={productPulseClassNames("ppFullWidthPage", "ppAppPage", className)} {...labelProps}>
      {title && <h1 id={titleId || undefined} className="ppPageTitle">{title}</h1>}
      {children}
    </main>
  );
}

export function PageShell({ children, className = "" }) {
  return <div className={productPulseClassNames("ppShell", "ppAppShell", className)}>{children}</div>;
}

export function PageHeader({ actions = null, children, className = "", description = "", eyebrow = "", title = "" }) {
  return (
    <header className={productPulseClassNames("ppPageHeader", className)}>
      <div className="ppPageHeaderCopy">
        {eyebrow && <span className="ppPageEyebrow">{eyebrow}</span>}
        {title && <h1 className="ppPageHeaderTitle">{title}</h1>}
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="ppPageHeaderActions">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ actions = null, children, className = "", description = "", eyebrow = "", title = "" }) {
  return (
    <div className={productPulseClassNames("ppSectionHeader", className)}>
      <div className="ppSectionHeaderCopy">
        {eyebrow && <span className="ppSectionEyebrow">{eyebrow}</span>}
        {title && <h2>{title}</h2>}
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="ppSectionHeaderActions">{actions}</div>}
    </div>
  );
}

export function DashboardCard({ as = "section", children, className = "", tone = "neutral", ...props }) {
  const Component = as;
  return (
    <Component className={productPulseClassNames("ppPanel", "ppDashboardCard", `ppPanel-${tone}`, className)} {...props}>
      {children}
    </Component>
  );
}

export const Panel = DashboardCard;

export function ChartPanel({ children, className = "", title = "", description = "", actions = null, ...props }) {
  return (
    <DashboardCard className={productPulseClassNames("ppChartPanel", className)} {...props}>
      {(title || description || actions) && (
        <SectionHeader title={title} description={description} actions={actions} />
      )}
      <div className="ppChartPanelBody">{children}</div>
    </DashboardCard>
  );
}

export function MetricCard({
  as = "article",
  children,
  className = "",
  detail = "",
  icon = null,
  label,
  tone = "neutral",
  trend = "",
  value,
  ...props
}) {
  const Component = as;
  return (
    <Component className={productPulseClassNames("ppUiMetricCard", `ppUiMetricCard-${tone}`, className)} {...props}>
      {icon}
      <div className="ppMetricCardBody">
        <h2>{label}</h2>
        <strong>{value}</strong>
        {children || (
          trend
            ? <span className="ppMetricCardTrend">{trend}</span>
            : detail
              ? <span className="ppMetricCardDetail">{detail}</span>
              : null
        )}
      </div>
    </Component>
  );
}

export function DataTable({ caption = "", children, className = "", minWidth = "", ...props }) {
  const style = minWidth ? { "--pp-data-table-min-width": minWidth } : undefined;
  return (
    <div className={productPulseClassNames("ppDataTableWrap", className)} style={style}>
      <table className="ppDataTable" {...props}>
        {caption && <caption>{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function StatusBadge({ children, className = "", icon = null, showMarker = true, tone = "neutral", ...props }) {
  return (
    <span className={productPulseClassNames("ppStatusBadge", `ppStatusBadge-${tone}`, className)} {...props}>
      {showMarker && <span className="ppStatusBadgeMarker" aria-hidden="true" />}
      {icon}
      <span>{children}</span>
    </span>
  );
}

export function EmptyState({ action = null, children, className = "", description = "", icon = null, title = "" }) {
  return (
    <div className={productPulseClassNames("ppEmptyState", className)}>
      {icon && <span className="ppEmptyStateIcon" aria-hidden="true">{icon}</span>}
      <div>
        {title && <h2>{title}</h2>}
        {description && <p>{description}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ className = "", message = "Loading data", title = "Loading" }) {
  return (
    <div className={productPulseClassNames("ppLoadingState", className)} role="status" aria-live="polite">
      <span className="ppMiniSpinner" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
    </div>
  );
}

export function ErrorState({ action = null, className = "", message = "", title = "Something went wrong" }) {
  return (
    <div className={productPulseClassNames("ppErrorState", className)} role="alert">
      <span className="ppErrorStateIcon" aria-hidden="true">
        <s-icon type="alert-triangle" size="small"></s-icon>
      </span>
      <div>
        <strong>{title}</strong>
        {message && <span>{message}</span>}
      </div>
      {action}
    </div>
  );
}

export function FilterBar({ actions = null, children, className = "", label = "Filters" }) {
  return (
    <section className={productPulseClassNames("ppFilterBar", className)} aria-label={label}>
      <div className="ppFilterBarControls">{children}</div>
      {actions && <div className="ppFilterBarActions">{actions}</div>}
    </section>
  );
}

export function InsightCard({ children, className = "", detail = "", metric = "", title = "", tone = "neutral" }) {
  return (
    <DashboardCard as="article" className={productPulseClassNames("ppInsightCard", className)} tone={tone}>
      {metric && <span className="ppInsightCardMetric">{metric}</span>}
      {title && <h3>{title}</h3>}
      {detail && <p>{detail}</p>}
      {children}
    </DashboardCard>
  );
}

export function RecommendationCard({ action = null, children, className = "", detail = "", title = "", tone = "info" }) {
  return (
    <DashboardCard as="article" className={productPulseClassNames("ppRecommendationCard", className)} tone={tone}>
      <div>
        {title && <h3>{title}</h3>}
        {detail && <p>{detail}</p>}
        {children}
      </div>
      {action}
    </DashboardCard>
  );
}
