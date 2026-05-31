/* eslint-env node */
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAiUsageDashboardForShop,
  isAiCostDashboardEnabled,
} from "../ai/observability/usageEvents.server";
import aiCostsStylesheet from "../styles/product-pulse-ai-costs.css?url";

export const links = () => [
  { rel: "stylesheet", href: aiCostsStylesheet },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  if (!isAiCostDashboardEnabled()) {
    throw new Response("Not found", { status: 404 });
  }

  return {
    shop: session.shop,
    dashboard: await getAiUsageDashboardForShop(session.shop),
  };
};

export default function AiCosts() {
  const { shop, dashboard } = useLoaderData();
  const totals = dashboard.totals || {};
  const last7Days = dashboard.last7Days || {};
  const last30Days = dashboard.last30Days || {};

  return (
    <main className="ppAiCostsPage">
      <header className="ppAiCostsHero">
        <div>
          <span className="ppAiCostsEyebrow">AI observability</span>
          <h1>AI costs</h1>
          <p>
            Estimated AI spend for chat, product diagnosis, CSV import mapping, watchlist narratives, and any other tracked AI call.
          </p>
        </div>
        <div className="ppAiCostsHeroMeta" aria-label="AI cost dashboard metadata">
          <span>{shop}</span>
          <span>Updated {formatDateTime(dashboard.generatedAt)}</span>
        </div>
      </header>

      <section className="ppAiCostsKpis" aria-label="AI cost totals">
        <CostKpi
          label="All tracked AI cost"
          value={formatUsd(totals.estimatedTotalUsd)}
          detail={`${formatInteger(totals.eventCount)} tracked calls`}
          tone="money"
        />
        <CostKpi
          label="Last 30 days"
          value={formatUsd(last30Days.estimatedTotalUsd)}
          detail={`${formatInteger(last30Days.totalTokens)} tokens`}
          tone="blue"
        />
        <CostKpi
          label="Last 7 days"
          value={formatUsd(last7Days.estimatedTotalUsd)}
          detail={`${formatInteger(last7Days.eventCount)} calls`}
          tone="green"
        />
        <CostKpi
          label="Needs pricing"
          value={formatInteger(totals.unknownCostEvents)}
          detail="Calls excluded from USD total"
          tone={totals.unknownCostEvents ? "amber" : "muted"}
        />
      </section>

      <section className="ppAiCostsGrid">
        <Panel title="Spend by AI area" subtitle="Where tracked AI cost is coming from">
          <GroupTable
            rows={dashboard.bySource}
            columns={[
              { key: "label", label: "Area" },
              { key: "estimatedTotalUsd", label: "Cost", align: "right", format: formatUsd },
              { key: "eventCount", label: "Calls", align: "right", format: formatInteger },
              { key: "totalTokens", label: "Tokens", align: "right", format: formatInteger },
            ]}
          />
        </Panel>

        <Panel title="Spend by model" subtitle="Provider and model-level estimate">
          <GroupTable
            rows={dashboard.byModel}
            columns={[
              { key: "label", label: "Model" },
              { key: "estimatedTotalUsd", label: "Cost", align: "right", format: formatUsd },
              { key: "eventCount", label: "Calls", align: "right", format: formatInteger },
              { key: "unknownCostEvents", label: "Unpriced", align: "right", format: formatInteger },
            ]}
          />
        </Panel>

        <Panel title="Task mix" subtitle="Tasks ranked by estimated cost">
          <GroupTable
            rows={dashboard.byTask}
            columns={[
              { key: "label", label: "Task" },
              { key: "estimatedTotalUsd", label: "Cost", align: "right", format: formatUsd },
              { key: "eventCount", label: "Calls", align: "right", format: formatInteger },
              { key: "totalTokens", label: "Tokens", align: "right", format: formatInteger },
            ]}
          />
        </Panel>

        <Panel title="Token totals" subtitle="Billable shape across tracked calls">
          <div className="ppAiCostsTokenGrid">
            <TokenStat label="Input" value={totals.inputTokens} />
            <TokenStat label="Cached input" value={totals.cachedInputTokens} />
            <TokenStat label="Output" value={totals.outputTokens} />
            <TokenStat label="Reasoning" value={totals.reasoningTokens} />
          </div>
        </Panel>
      </section>

      <section className="ppAiCostsRecent">
        <Panel title="Recent AI calls" subtitle="Latest tracked calls for this shop">
          <RecentEventsTable rows={dashboard.recentEvents} />
        </Panel>
      </section>

      {dashboard.notes?.length ? (
        <aside className="ppAiCostsNotes" aria-label="AI cost notes">
          {dashboard.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </aside>
      ) : null}
    </main>
  );
}

function CostKpi({ label, value, detail, tone }) {
  return (
    <article className={`ppAiCostsKpi ppAiCostsKpi-${tone || "muted"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="ppAiCostsPanel">
      <div className="ppAiCostsPanelHeader">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function GroupTable({ rows = [], columns = [] }) {
  if (!rows.length) {
    return <EmptyTable message="No AI usage has been tracked for this shop yet." />;
  }

  return (
    <div className="ppAiCostsTableWrap">
      <table className="ppAiCostsTable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "isRight" : ""}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === "right" ? "isRight" : ""}>
                  {column.format ? column.format(row[column.key]) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TokenStat({ label, value }) {
  return (
    <div className="ppAiCostsTokenStat">
      <span>{label}</span>
      <strong>{formatInteger(value)}</strong>
    </div>
  );
}

function RecentEventsTable({ rows = [] }) {
  if (!rows.length) {
    return <EmptyTable message="No recent AI calls have been recorded." />;
  }

  return (
    <div className="ppAiCostsTableWrap">
      <table className="ppAiCostsTable ppAiCostsRecentTable">
        <thead>
          <tr>
            <th>Time</th>
            <th>Area</th>
            <th>Task</th>
            <th>Model</th>
            <th className="isRight">Tokens</th>
            <th className="isRight">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatDateTime(row.createdAt)}</td>
              <td>
                <span className={row.legacy ? "ppAiCostsLegacyBadge" : "ppAiCostsBadge"}>
                  {row.sourceLabel}
                </span>
              </td>
              <td>{formatTask(row.task || row.operation)}</td>
              <td>{formatModel(row.provider, row.model)}</td>
              <td className="isRight">{formatInteger(row.usage?.totalTokens)}</td>
              <td className="isRight">{formatUsd(row.estimatedCost?.totalUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTable({ message }) {
  return (
    <div className="ppAiCostsEmpty">
      <strong>No data</strong>
      <span>{message}</span>
    </div>
  );
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Pricing needed";
  if (number === 0) return "$0.00";
  const fractionDigits = number < 0.01 ? 6 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(number);
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTask(value) {
  return String(value || "Unknown")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatModel(provider, model) {
  const providerLabel = String(provider || "unknown").toLowerCase() === "openai"
    ? "OpenAI"
    : String(provider || "Unknown");
  return `${providerLabel} / ${model || "unknown"}`;
}
