/* eslint-env node */

const SHOP_EMAIL_QUERY = `#graphql
  query ProductPulseWatchlistShopEmail {
    shop {
      email
    }
  }
`;

export async function getWatchlistDefaultAlertRecipients(admin, session = {}) {
  const shopEmail = await getShopEmail(admin);
  const recipients = normalizeAlertRecipients([shopEmail, session?.email]);
  return recipients.slice(0, 1);
}

async function getShopEmail(admin) {
  if (!admin || typeof admin.graphql !== "function") return "";

  try {
    const response = await admin.graphql(SHOP_EMAIL_QUERY);
    const json = await response.json();
    return json?.data?.shop?.email || "";
  } catch {
    return "";
  }
}

function normalizeAlertRecipients(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
