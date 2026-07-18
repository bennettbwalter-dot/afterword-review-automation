import { readFile } from "node:fs/promises";

import Stripe from "stripe";

const EXPECTED_ACCOUNT_ID = "acct_1TuBZu3legZQZqX7";
const API_VERSION = "2026-06-24.dahlia";
const INTEGRATION = "review_anchor";

function parseEnv(source) {
  const values = new Map();

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }

  return values;
}

async function collect(list) {
  const items = [];
  for await (const item of list) items.push(item);
  return items;
}

function assertPrice(price, definition, productId) {
  const actualProductId =
    typeof price.product === "string" ? price.product : price.product.id;
  const actualInterval = price.recurring?.interval ?? null;

  if (
    price.livemode ||
    !price.active ||
    price.currency !== "gbp" ||
    price.unit_amount !== definition.unitAmount ||
    price.type !== definition.type ||
    actualInterval !== (definition.interval ?? null) ||
    actualProductId !== productId
  ) {
    throw new Error(
      `Existing Stripe Price ${definition.lookupKey} does not match the Review Anchor catalog contract.`,
    );
  }
}

async function ensureProduct(stripe, definition) {
  const products = await collect(stripe.products.list({ active: true, limit: 100 }));
  const matches = products.filter(
    (product) =>
      !product.livemode &&
      product.metadata.integration === INTEGRATION &&
      product.metadata.product_key === definition.key,
  );

  if (matches.length > 1) {
    throw new Error(`Multiple active Stripe products exist for ${definition.key}.`);
  }
  if (matches.length === 1) return { product: matches[0], created: false };

  const product = await stripe.products.create(
    {
      name: definition.name,
      description: definition.description,
      metadata: {
        integration: INTEGRATION,
        product_key: definition.key,
      },
    },
    { idempotencyKey: `review-anchor-product-${definition.key}-v1` },
  );

  return { product, created: true };
}

async function ensurePrice(stripe, definition, productId) {
  const existing = await stripe.prices.list({
    active: true,
    lookup_keys: [definition.lookupKey],
    limit: 10,
  });

  if (existing.data.length > 1) {
    throw new Error(`Multiple active Stripe prices exist for ${definition.lookupKey}.`);
  }
  if (existing.data.length === 1) {
    assertPrice(existing.data[0], definition, productId);
    return { price: existing.data[0], created: false };
  }

  const price = await stripe.prices.create(
    {
      product: productId,
      currency: "gbp",
      unit_amount: definition.unitAmount,
      lookup_key: definition.lookupKey,
      nickname: definition.nickname,
      ...(definition.interval
        ? { recurring: { interval: definition.interval } }
        : {}),
      metadata: {
        integration: INTEGRATION,
        price_key: definition.lookupKey,
      },
    },
    { idempotencyKey: `review-anchor-price-${definition.lookupKey}-v1` },
  );

  assertPrice(price, definition, productId);
  return { price, created: true };
}

const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
const apiKey = env.get("STRIPE_API_KEY") ?? "";

if (!/^(rk|sk)_test_/u.test(apiKey) || apiKey.includes("REPLACE_ME")) {
  throw new Error("STRIPE_API_KEY must be a non-placeholder Stripe test key.");
}

const stripe = new Stripe(apiKey, {
  apiVersion: API_VERSION,
  appInfo: { name: "Review Anchor", version: "1.0.0" },
});

const account = await stripe.accounts.retrieve();
if (account.id !== EXPECTED_ACCOUNT_ID) {
  throw new Error(
    `The configured Stripe key belongs to ${account.id}, not ${EXPECTED_ACCOUNT_ID}.`,
  );
}

const productDefinitions = [
  {
    key: "pro",
    name: "Review Anchor Pro",
    description: "Review collection and customer follow-up for one location.",
  },
  {
    key: "multi",
    name: "Review Anchor Multi-location",
    description: "Review collection and customer follow-up across multiple locations.",
  },
  {
    key: "setup",
    name: "Review Anchor Setup",
    description: "One-time onboarding and account setup.",
  },
];

const priceDefinitions = [
  {
    envKey: "STRIPE_PRICE_PRO_MONTHLY",
    productKey: "pro",
    lookupKey: "review_anchor_pro_monthly",
    nickname: "Pro monthly — £39",
    unitAmount: 3900,
    type: "recurring",
    interval: "month",
  },
  {
    envKey: "STRIPE_PRICE_PRO_ANNUAL",
    productKey: "pro",
    lookupKey: "review_anchor_pro_annual",
    nickname: "Pro annual — £390",
    unitAmount: 39000,
    type: "recurring",
    interval: "year",
  },
  {
    envKey: "STRIPE_PRICE_MULTI_MONTHLY",
    productKey: "multi",
    lookupKey: "review_anchor_multi_monthly",
    nickname: "Multi-location monthly — £79",
    unitAmount: 7900,
    type: "recurring",
    interval: "month",
  },
  {
    envKey: "STRIPE_PRICE_SETUP_PRO",
    productKey: "setup",
    lookupKey: "review_anchor_setup_149",
    nickname: "Setup — £149",
    unitAmount: 14900,
    type: "one_time",
  },
  {
    envKey: "STRIPE_PRICE_SETUP_MULTI_2_3",
    productKey: "setup",
    lookupKey: "review_anchor_setup_249",
    nickname: "Setup — £249",
    unitAmount: 24900,
    type: "one_time",
  },
  {
    envKey: "STRIPE_PRICE_SETUP_MULTI_4_5",
    productKey: "setup",
    lookupKey: "review_anchor_setup_349",
    nickname: "Setup — £349",
    unitAmount: 34900,
    type: "one_time",
  },
];

const products = new Map();
const productResults = [];
for (const definition of productDefinitions) {
  const result = await ensureProduct(stripe, definition);
  products.set(definition.key, result.product);
  productResults.push({
    key: definition.key,
    id: result.product.id,
    created: result.created,
  });
}

const priceResults = [];
for (const definition of priceDefinitions) {
  const product = products.get(definition.productKey);
  const result = await ensurePrice(stripe, definition, product.id);
  priceResults.push({
    envKey: definition.envKey,
    id: result.price.id,
    created: result.created,
    amount: definition.unitAmount,
    interval: definition.interval ?? null,
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      accountId: account.id,
      currency: "gbp",
      livemode: false,
      products: productResults,
      prices: priceResults,
    },
    null,
    2,
  )}\n`,
);
