import { useEffect, useMemo, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useNavigation } from "react-router";
import appStylesheet from "./styles/product-pulse.css?url";
import chatKitStylesheet from "./styles/product-pulse-chatkit.css?url";

export const links = () => [
  { rel: "preconnect", href: "https://cdn.shopify.com/" },
  { rel: "stylesheet", href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css" },
  { rel: "stylesheet", href: appStylesheet },
  { rel: "stylesheet", href: chatKitStylesheet },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
      </head>
      <body>
        <Outlet />
        <ProductPulseRouteTransitionOverlay />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function ProductPulseRouteTransitionOverlay() {
  const location = useLocation();
  const navigation = useNavigation();
  const [clickPending, setClickPending] = useState(false);
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const navigationPath = navigation.location
    ? `${navigation.location.pathname}${navigation.location.search}${navigation.location.hash}`
    : "";
  const isRouteLoading = navigation.state === "loading" && navigationPath && navigationPath !== currentPath;
  const visible = Boolean(clickPending || isRouteLoading);

  useEffect(() => {
    setClickPending(false);
  }, [currentPath]);

  useEffect(() => {
    if (navigation.state === "idle" && !isRouteLoading) {
      const timeout = window.setTimeout(() => setClickPending(false), 80);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [isRouteLoading, navigation.state]);

  useEffect(() => {
    const handleClickCapture = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target?.closest?.("a[href], s-link[href]");
      if (!link) return;
      if (link.hasAttribute("download")) return;
      const target = link.getAttribute("target");
      if (target && target !== "_self") return;
      const href = link.getAttribute("href");
      const nextUrl = getProductPulseInternalNavigationUrl(href);
      if (!nextUrl) return;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (nextPath === currentPath) return;
      setClickPending(true);
    };

    document.addEventListener("click", handleClickCapture, true);
    return () => document.removeEventListener("click", handleClickCapture, true);
  }, [currentPath]);

  const loadingCopy = useMemo(() => (
    isRouteLoading ? "Loading page" : "Opening page"
  ), [isRouteLoading]);

  return (
    <div className={`ppRouteLoadingOverlay${visible ? " isVisible" : ""}`} role="status" aria-live="polite" aria-hidden={!visible}>
      <div className="ppRouteLoadingCard">
        <span className="ppRouteLoadingSpinner" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <strong>{loadingCopy}</strong>
      </div>
    </div>
  );
}

function getProductPulseInternalNavigationUrl(href) {
  if (!href || typeof window === "undefined") return null;
  try {
    const nextUrl = new URL(href, window.location.href);
    if (nextUrl.origin !== window.location.origin) return null;
    if (!nextUrl.pathname.startsWith("/app")) return null;
    return nextUrl;
  } catch {
    return null;
  }
}
