/**
 * Configuration Service
 * Centralizes all configuration values for the chat service
 */

export const AppConfig = {
  // API Configuration
  api: {
    defaultModel: process.env.CLAUDE_MODEL || 'claude-haiku-4-5',
    maxTokens: Number(process.env.CLAUDE_MAX_TOKENS || 1200),
    maxConversationMessages: Number(process.env.CLAUDE_CONTEXT_MESSAGES || 12),
    maxToolResultCharacters: Number(process.env.CLAUDE_MAX_TOOL_RESULT_CHARS || 1500),
    maxCartContextCharacters: Number(process.env.CLAUDE_MAX_CART_CONTEXT_CHARS || 500),
    summaryTriggerMessages: Number(process.env.CLAUDE_SUMMARY_TRIGGER_MESSAGES || 18),
    summaryRecentMessages: Number(process.env.CLAUDE_SUMMARY_RECENT_MESSAGES || 8),
    summaryMaxTokens: Number(process.env.CLAUDE_SUMMARY_MAX_TOKENS || 250),
    defaultPromptType: 'standardAssistant',
  },

  // Error Message Templates
  errorMessages: {
    missingMessage: "Message is required",
    apiUnsupported: "This endpoint only supports server-sent events (SSE) requests or history requests.",
    authFailed: "Authentication failed with Claude API",
    apiKeyError: "Please check your API key in environment variables",
    rateLimitExceeded: "Rate limit exceeded",
    rateLimitDetails: "Please try again later",
    genericError: "Failed to get response from Claude"
  },

  // Tool Configuration
  tools: {
    productSearchName: "search_shop_catalog",
    maxProductsToDisplay: 3
  }
};

export default AppConfig;
