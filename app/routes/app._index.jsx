import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  clearShopClaudeApiKey,
  hasShopClaudeApiKey,
  saveShopClaudeApiKey,
} from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const isConfigured = await hasShopClaudeApiKey(session.shop);
  const appApiKey = process.env.SHOPIFY_API_KEY || "";
  const themeExtensionHandle = "chat-bubble";
  const activateAppId = appApiKey
    ? `${appApiKey}/${themeExtensionHandle}`
    : "";
  const themeEditorUrl = `https://${session.shop}/admin/themes/current/editor?context=apps&template=index${
    activateAppId ? `&activateAppId=${encodeURIComponent(activateAppId)}` : ""
  }`;

  return {
    shop: session.shop,
    isConfigured,
    themeEditorUrl,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save") {
    const apiKey = (formData.get("claudeApiKey") || "").toString().trim();

    if (!apiKey) {
      return {
        ok: false,
        message: "Claude API key is required.",
      };
    }

    await saveShopClaudeApiKey(session.shop, apiKey);
    return {
      ok: true,
      message: "Claude API key saved successfully.",
    };
  }

  if (intent === "clear") {
    await clearShopClaudeApiKey(session.shop);
    return {
      ok: true,
      message: "Claude API key removed.",
    };
  }

  return {
    ok: false,
    message: "Invalid action.",
  };
};

export default function Index() {
  const { shop, isConfigured, themeEditorUrl } = useLoaderData();
  const actionData = useActionData();

  const hasKeyConfigured = actionData?.ok
    ? actionData?.message !== "Claude API key removed."
    : isConfigured;
  const statusTone = hasKeyConfigured ? "success" : "warning";
  const statusLabel = hasKeyConfigured
    ? "Claude API key is configured for this shop."
    : "Claude API key is not configured yet.";

  return (
    <s-page>
      <ui-title-bar title="Chat Agent - Opal Setup" />

      <s-section>
        <s-stack gap="base">
          <s-heading>Make Your Store Chat Available in 4 Steps</s-heading>
          <s-paragraph>
            This app adds an AI shopping assistant to your storefront. Follow the
            checklist below to configure Claude, enable the theme extension, and
            verify the chat is live for shoppers.
          </s-paragraph>
          <s-banner tone={statusTone}>
            <s-text>{statusLabel}</s-text>
          </s-banner>
        </s-stack>
      </s-section>

      <s-section heading="Setup Checklist">
        <s-stack gap="base">
          <s-paragraph>
            1. Save Claude API key in the section below.
          </s-paragraph>
          <s-paragraph>
            2. Open your Online Store theme editor.
          </s-paragraph>
          <s-paragraph>
            3. Enable the app embed for this app and click Save.
          </s-paragraph>
          <s-paragraph>
            4. Open the storefront and test messages like "Show me trending products" or
            "What is in my cart?".
          </s-paragraph>
          <s-paragraph>
            <s-link href={themeEditorUrl} target="_top">
              Open Theme Editor
            </s-link>
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Claude API Key Settings">
        <s-stack gap="base">
          <s-paragraph>
            Shop: <s-text>{shop}</s-text>
          </s-paragraph>
          <s-paragraph>
            Current status: <s-text>{hasKeyConfigured ? "Configured" : "Not configured"}</s-text>
          </s-paragraph>

          {actionData?.message ? (
            <s-banner tone={actionData.ok ? "success" : "critical"}>
              <s-text>{actionData.message}</s-text>
            </s-banner>
          ) : null}

          <form method="post">
            <input type="hidden" name="intent" value="save" />
            <s-stack gap="base">
              <input
                type="password"
                name="claudeApiKey"
                placeholder="sk-ant-api03-..."
                autoComplete="off"
                style={{ padding: "8px", width: "100%", maxWidth: "560px" }}
              />
              <button type="submit">Save Claude API Key</button>
            </s-stack>
          </form>

          <form method="post">
            <input type="hidden" name="intent" value="clear" />
            <button type="submit">Clear Claude API Key</button>
          </form>

          <s-paragraph>
            If no shop key is configured, the app falls back to server-level CLAUDE_API_KEY.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Enable Theme Extension" slot="aside">
        <s-stack gap="base">
          <s-paragraph>
            In Shopify Admin go to Online Store &rarr; Themes &rarr; Customize.
          </s-paragraph>
          <s-paragraph>
            Open App embeds, turn on "AI Chat Assistant", and click Save.
          </s-paragraph>
          <s-paragraph>
            <s-link href={themeEditorUrl} target="_top">
              Open Theme Editor
            </s-link>
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Quick Test Prompts" slot="aside">
        <s-stack gap="base">
          <s-paragraph>"Hi, help me find a gift under $50"</s-paragraph>
          <s-paragraph>"Show me what is in my cart"</s-paragraph>
          <s-paragraph>"Add one more of the first product to cart"</s-paragraph>
          <s-paragraph>"How long is shipping?"</s-paragraph>
        </s-stack>
      </s-section>

    </s-page>
  );
}
