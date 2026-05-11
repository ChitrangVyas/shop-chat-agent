/**
 * Chat API Route
 * Handles chat interactions with Claude API and tools
 *
 * Production/Vercel compatibility notes:
 * - The theme extension chat widget now uses a dynamic backend URL (window.shopChatConfig.backendUrl or /apps/chat-agent-opal/).
 * - For Vercel, ensure this route is exposed at /api/chat or /apps/chat-agent-opal/chat (via Vercel config or Shopify App Proxy).
 * - Set CLAUDE_API_KEY and DATABASE_URL in Vercel environment variables.
 * - For Shopify App Proxy, configure the proxy path to forward /apps/chat-agent-opal/* to this backend.
 */
// If deploying to Vercel, ensure this file is included in the Vercel build output and the route is mapped correctly.
import MCPClient from "../mcp-client";
import {
  saveMessage,
  getConversationHistory,
  getConversationSummary,
  updateConversationSummary,
  storeCustomerAccountUrls,
  getCustomerAccountUrls as getCustomerAccountUrlsFromDb,
  getShopClaudeApiKey,
} from "../db.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";


/**
 * Rract Router loader function for handling GET requests
 */
export async function loader({ request }) {
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);

  // Handle history fetch requests - matches /chat?history=true&conversation_id=XYZ
  if (url.searchParams.has('history') && url.searchParams.has('conversation_id')) {
    return handleHistoryRequest(request, url.searchParams.get('conversation_id'));
  }

  // Handle SSE requests
  if (!url.searchParams.has('history') && request.headers.get("Accept") === "text/event-stream") {
    return handleChatRequest(request);
  }

  // Health/info response for plain browser GETs via app proxy.
  if (request.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        service: "chat",
        message: "Use POST /chat for chat requests or GET /chat?history=true&conversation_id=... for history."
      }),
      {
        status: 200,
        headers: {
          ...getCorsHeaders(request),
          "Content-Type": "application/json"
        }
      }
    );
  }

  // API-only: reject all other requests
  return new Response(JSON.stringify({ error: AppConfig.errorMessages.apiUnsupported }), { status: 400, headers: getCorsHeaders(request) });
}

/**
 * React Router action function for handling POST requests
 */
export async function action({ request }) {
  return handleChatRequest(request);
}

/**
 * Handle history fetch requests
 * @param {Request} request - The request object
 * @param {string} conversationId - The conversation ID
 * @returns {Response} JSON response with chat history
 */
async function handleHistoryRequest(request, conversationId) {
  const messages = await getConversationHistory(conversationId);

  return new Response(JSON.stringify({ messages }), { headers: getCorsHeaders(request) });
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  try {
    // Get message data from request body
    const body = await request.json();
    const userMessage = body.message;
    const storefrontCart = body.storefront_cart || null;

    // Validate required message
    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || AppConfig.api.defaultPromptType;

    // Create a stream for the response
    const responseStream = createSseStream(async (stream) => {
      await handleChatSession({
        request,
        userMessage,
        conversationId,
        promptType,
        storefrontCart,
        stream
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request)
    });
  } catch (error) {
    console.error('Error in chat request handler:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: getCorsHeaders(request)
    });
  }
}

/**
 * Handle a complete chat session
 * @param {Object} params - Session parameters
 * @param {Request} params.request - The request object
 * @param {string} params.userMessage - The user's message
 * @param {string} params.conversationId - The conversation ID
 * @param {string} params.promptType - The prompt type
 * @param {Object|null} params.storefrontCart - Existing storefront cart snapshot from theme
 * @param {Object} params.stream - Stream manager for sending responses
 */
async function handleChatSession({
  request,
  userMessage,
  conversationId,
  promptType,
  storefrontCart,
  stream
}) {
  // Initialize services
  const toolService = createToolService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const originHeader = request.headers.get("Origin") || "";
  const explicitShopDomain = request.headers.get("X-Shopify-Shop-Domain") || "";
  const shopQueryParam = new URL(request.url).searchParams.get("shop") || "";
  const resolvedShopDomain = resolveShopDomain({
    explicitShopDomain,
    shopQueryParam,
    originHeader,
  });

  if (!resolvedShopDomain) {
    stream.sendMessage({
      type: 'error',
      error: 'Shop domain cannot be determined from request headers/query'
    });
    throw new Error('Shop domain cannot be determined');
  }

  const shopBaseUrl = `https://${resolvedShopDomain}`;
  const shopClaudeApiKey = await getShopClaudeApiKey(resolvedShopDomain);
  const claudeApiKey = shopClaudeApiKey || process.env.CLAUDE_API_KEY;

  if (!claudeApiKey) {
    stream.sendMessage({
      type: 'error',
      error: 'Claude API key is not configured for this shop. Add it in the embedded app settings.'
    });
    throw new Error('Claude API key is not configured');
  }

  const claudeService = createClaudeService(claudeApiKey);

  let customerAccountUrls = null;
  try {
    customerAccountUrls = await getCustomerAccountUrls(shopBaseUrl, conversationId);
  } catch (error) {
    console.warn('Failed to get customer account URLs:', error.message);
  }
  
  const mcpApiUrl = customerAccountUrls?.mcpApiUrl;

  const mcpClient = new MCPClient(
    shopBaseUrl,
    conversationId,
    shopId,
    mcpApiUrl,
  );

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });

    // Connect to MCP servers and get available tools
    let storefrontMcpTools = [], customerMcpTools = [];

    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();

      console.log(`Connected to MCP with ${storefrontMcpTools.length} tools`);
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
    } catch (error) {
      console.warn('Failed to connect to MCP servers, continuing without tools:', error.message);
    }

    // Prepare conversation state
    let conversationHistory = [];
    let productsToDisplay = [];

    // Save user message to the database
    await saveMessage(conversationId, 'user', userMessage);

    // Fetch all messages from the database for this conversation
    const dbMessages = await getConversationHistory(conversationId);
    const conversationSummary = await getConversationSummary(conversationId);
    const summaryState = await maybeRefreshConversationSummary({
      claudeService,
      conversationId,
      dbMessages,
      conversationSummary
    });

    // Format messages for Claude API
    conversationHistory = buildConversationHistory({
      dbMessages,
      summaryState,
    });

    if (storefrontCart && typeof storefrontCart === 'object') {
      conversationHistory.push({
        role: 'assistant',
        content: buildStorefrontCartContext(storefrontCart)
      });
    }

    // Execute the conversation stream
    let finalMessage = { role: 'user', content: userMessage };

    while (finalMessage.stop_reason !== "end_turn") {
      finalMessage = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools
        },
        {
          // Handle text chunks
          onText: (textDelta) => {
            stream.sendMessage({
              type: 'chunk',
              chunk: textDelta
            });
          },

          // Handle complete messages
          onMessage: (message) => {
            conversationHistory.push({
              role: message.role,
              content: message.content
            });

            saveMessage(conversationId, message.role, JSON.stringify(message.content))
              .catch((error) => {
                console.error("Error saving message to database:", error);
              });

            // Send a completion message
            stream.sendMessage({ type: 'message_complete' });
          },

          // Handle tool use requests
          onToolUse: async (content) => {
            const toolName = content.name;
            const rawToolArgs = content.input;
            const toolArgs = withStorefrontCartIdentity(
              toolName,
              rawToolArgs,
              storefrontCart,
              mcpClient.tools
            );
            const toolUseId = content.id;

            const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;

            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });

            // Call the tool
            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

            // Handle tool response based on success/error
            if (toolUseResponse.error) {
              await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                productsToDisplay,
                conversationId
              );
            }

            // Signal new message to client
            stream.sendMessage({ type: 'new_message' });
          },

          // Handle content block completion
          onContentBlock: (contentBlock) => {
            if (contentBlock.type === 'text') {
              stream.sendMessage({
                type: 'content_block_complete',
                content_block: contentBlock
              });
            }
          }
        }
      );
    }

    // Signal end of turn
    stream.sendMessage({ type: 'end_turn' });

    // Send product results if available
    if (productsToDisplay.length > 0) {
      stream.sendMessage({
        type: 'product_results',
        products: productsToDisplay
      });
    }
  } catch (error) {
    console.error('Error in chat session:', error);
    stream.sendMessage({
      type: 'error',
      error: error.message || 'An error occurred while processing your message'
    });
    throw error;
  }
}

/**
 * Builds the conversation history from stored messages and an optional summary.
 * @param {Object} params - History parameters
 * @param {Array} params.dbMessages - Stored messages for the conversation
 * @param {Object|null} params.summaryState - Stored summary metadata
 * @returns {Array} Claude-ready conversation messages
 */
function buildConversationHistory({ dbMessages, summaryState }) {
  const summaryText = summaryState?.summary || '';
  const summaryMessageCount = Number(summaryState?.summaryMessageCount || 0);
  const rawMessages = summaryMessageCount > 0
    ? dbMessages.slice(summaryMessageCount)
    : dbMessages;
  const recentWindow = summaryText
    ? Math.max(AppConfig.api.maxConversationMessages - 1, 1)
    : AppConfig.api.maxConversationMessages;
  const recentMessages = rawMessages.slice(-recentWindow);

  const conversationHistory = [];

  if (summaryText) {
    conversationHistory.push({
      role: 'assistant',
      content: `Conversation summary so far:\n${summaryText}`
    });
  }

  for (const dbMessage of recentMessages) {
    let content;
    try {
      content = JSON.parse(dbMessage.content);
    } catch (e) {
      content = dbMessage.content;
    }

    conversationHistory.push({
      role: dbMessage.role,
      content
    });
  }

  return conversationHistory;
}

/**
 * Refreshes the stored conversation summary when the raw history grows too large.
 * @param {Object} params - Summary parameters
 * @param {Object} params.claudeService - Claude service instance
 * @param {string} params.conversationId - Conversation ID
 * @param {Array} params.dbMessages - Stored messages for the conversation
 * @param {Object|null} params.conversationSummary - Stored summary metadata
 * @returns {Promise<Object>} Updated summary state
 */
async function maybeRefreshConversationSummary({ claudeService, conversationId, dbMessages, conversationSummary }) {
  const currentSummary = conversationSummary?.summary || '';
  const summaryMessageCount = Number(conversationSummary?.summaryMessageCount || 0);
  const unsummarizedMessages = summaryMessageCount > 0
    ? dbMessages.slice(summaryMessageCount)
    : dbMessages;

  if (unsummarizedMessages.length <= AppConfig.api.summaryTriggerMessages) {
    return {
      summary: currentSummary,
      summaryMessageCount
    };
  }

  const recentMessagesToKeep = Math.max(AppConfig.api.summaryRecentMessages, 1);
  const messagesToSummarize = unsummarizedMessages.slice(0, Math.max(unsummarizedMessages.length - recentMessagesToKeep, 0));

  if (messagesToSummarize.length === 0) {
    return {
      summary: currentSummary,
      summaryMessageCount
    };
  }

  try {
    const updatedSummary = await claudeService.summarizeConversation({
      previousSummary: currentSummary,
      messages: messagesToSummarize.map((message) => {
        let content;
        try {
          content = JSON.parse(message.content);
        } catch (error) {
          content = message.content;
        }

        return {
          role: message.role,
          content
        };
      })
    });

    const nextSummaryMessageCount = summaryMessageCount + messagesToSummarize.length;

    await updateConversationSummary(conversationId, updatedSummary, nextSummaryMessageCount);

    return {
      summary: updatedSummary,
      summaryMessageCount: nextSummaryMessageCount
    };
  } catch (error) {
    console.warn('Failed to refresh conversation summary:', error.message);
    return {
      summary: currentSummary,
      summaryMessageCount
    };
  }
}

/**
 * Adds storefront cart identity to cart tool calls when missing.
 * @param {string} toolName - Tool name
 * @param {Object} toolArgs - Tool input arguments
 * @param {Object|null} storefrontCart - Existing storefront cart snapshot
 * @param {Array} tools - Available MCP tools with input schemas
 * @returns {Object} Updated arguments
 */
function withStorefrontCartIdentity(toolName, toolArgs, storefrontCart, tools) {
  if (!isCartTool(toolName)) {
    return toolArgs;
  }

  const cartIdentity = storefrontCart?.token || storefrontCart?.id || null;
  const normalizedArgs = toolArgs && typeof toolArgs === 'object' ? { ...toolArgs } : {};

  if (!cartIdentity || hasCartIdentityArg(normalizedArgs)) {
    return normalizedArgs;
  }

  const cartArgName = getCartArgNameFromSchema(toolName, tools);
  if (!cartArgName) {
    return normalizedArgs;
  }

  normalizedArgs[cartArgName] = cartIdentity;
  return normalizedArgs;
}

/**
 * Detects whether the tool is cart-related.
 * @param {string} toolName - Tool name
 * @returns {boolean} True when tool is cart-related
 */
function isCartTool(toolName) {
  return typeof toolName === 'string' && toolName.toLowerCase().includes('cart');
}

/**
 * Checks whether cart identity is already present in arguments.
 * @param {Object} toolArgs - Tool arguments
 * @returns {boolean} True when cart id/token is already provided
 */
function hasCartIdentityArg(toolArgs) {
  const keys = Object.keys(toolArgs || {});
  return keys.some((key) => /^(cart_id|cartId|id|cart_token|cartToken|token)$/i.test(key));
}

/**
 * Picks the best cart identity argument name based on tool schema.
 * @param {string} toolName - Tool name
 * @param {Array} tools - Available MCP tools
 * @returns {string|null} Argument name or null if unknown
 */
function getCartArgNameFromSchema(toolName, tools) {
  const tool = (tools || []).find((entry) => entry.name === toolName);
  const properties = tool?.input_schema?.properties || {};
  const propertyNames = Object.keys(properties);

  const preferredNames = [
    'cart_id',
    'cartId',
    'cart_token',
    'cartToken',
    'token',
    'id'
  ];

  for (const name of preferredNames) {
    if (propertyNames.includes(name)) {
      return name;
    }
  }

  return propertyNames.find((name) => /cart.*(id|token)|^(id|token)$/i.test(name)) || null;
}

/**
 * Builds a compact cart summary for Claude context.
 * @param {Object} storefrontCart - Existing storefront cart snapshot
 * @returns {string} Compact cart context string
 */
function buildStorefrontCartContext(storefrontCart) {
  const compactCart = {
    id: storefrontCart?.id || null,
    token: storefrontCart?.token || null,
    itemCount: Array.isArray(storefrontCart?.lines)
      ? storefrontCart.lines.length
      : (Array.isArray(storefrontCart?.items) ? storefrontCart.items.length : null),
    currencyCode: storefrontCart?.currencyCode || storefrontCart?.currency || null,
    totalPrice: storefrontCart?.cost?.totalAmount?.amount || storefrontCart?.totalPrice || null,
  };

  const serializedCart = JSON.stringify(compactCart);
  const maxCharacters = AppConfig.api.maxCartContextCharacters;

  if (serializedCart.length <= maxCharacters) {
    return `Storefront cart context (existing shopper cart, read-only): ${serializedCart}. Use this context when the user asks what is currently in cart. If tool output differs, explain both clearly.`;
  }

  return `Storefront cart context (existing shopper cart, read-only): ${serializedCart.slice(0, maxCharacters)}... [truncated]. Use this context when the user asks what is currently in cart. If tool output differs, explain both clearly.`;
}

/**
 * Get the customer MCP API URL for a shop
 * @param {string} shopDomain - The shop domain
 * @param {string} conversationId - The conversation ID
 * @returns {string} The customer MCP API URL
 */
async function getCustomerAccountUrls(shopDomain, conversationId) {
  try {
    // Check if the customer account URL exists in the DB
    const existingUrls = await getCustomerAccountUrlsFromDb(conversationId);

    // If URL exists, return early with the MCP API URL
    if (existingUrls) return existingUrls;

    // If not, query for it from the Shopify API
    const { hostname } = new URL(shopDomain);

    console.log(`Fetching customer account URLs from ${hostname}`);

    const urls = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`).then(res => {
        if (!res.ok) throw new Error(`Failed to fetch customer-account-api: ${res.status}`);
        return res.json();
      }),
      fetch(`https://${hostname}/.well-known/openid-configuration`).then(res => {
        if (!res.ok) throw new Error(`Failed to fetch openid-configuration: ${res.status}`);
        return res.json();
      }),
    ]).then(async ([mcpResponse, openidResponse]) => {
      const response = {
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      };

      await storeCustomerAccountUrls({
        conversationId,
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      });

      return response;
    });

    return urls;
  } catch (error) {
    console.error("Error getting customer MCP API URL:", error);
    throw error;
  }
}

/**
 * Gets CORS headers for the response
 * @param {Request} request - The request object
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400" // 24 hours
  };
}

/**
 * Get SSE headers for the response
 * @param {Request} request - The request object
 * @returns {Object} SSE headers object
 */
function getSseHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  };
}

/**
 * Resolve shop domain from headers/query for app proxy compatibility.
 * @param {Object} params - Resolution inputs
 * @param {string} params.explicitShopDomain - X-Shopify-Shop-Domain header
 * @param {string} params.shopQueryParam - shop query parameter from app proxy
 * @param {string} params.originHeader - Origin header from browser requests
 * @returns {string} Normalized shop hostname or empty string
 */
function resolveShopDomain({ explicitShopDomain, shopQueryParam, originHeader }) {
  const candidates = [explicitShopDomain, shopQueryParam, originHeader].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const value = String(candidate).trim();
      const host = value.includes("://") ? new URL(value).hostname : value;
      if (host && host.includes(".myshopify.com")) {
        return host.toLowerCase();
      }
    } catch {
      // Ignore invalid candidates and continue with fallbacks.
    }
  }

  return "";
}
