/**
 * Claude Service
 * Manages interactions with the Claude API
 */
import { Anthropic } from "@anthropic-ai/sdk";
import AppConfig from "./config.server";
import systemPrompts from "../prompts/prompts.json";

/**
 * Creates a Claude service instance
 * @param {string} apiKey - Claude API key
 * @returns {Object} Claude service with methods for interacting with Claude API
 */
export function createClaudeService(apiKey = process.env.CLAUDE_API_KEY) {
  // Initialize Claude client
  const anthropic = new Anthropic({ apiKey });

  const limitConversationHistory = (messages) => {
    const maxMessages = AppConfig.api.maxConversationMessages;

    if (!Array.isArray(messages) || messages.length <= maxMessages) {
      return messages;
    }

    return messages.slice(-maxMessages);
  };

  /**
   * Streams a conversation with Claude
   * @param {Object} params - Stream parameters
   * @param {Array} params.messages - Conversation history
   * @param {string} params.promptType - The type of system prompt to use
   * @param {Array} params.tools - Available tools for Claude
   * @param {Object} streamHandlers - Stream event handlers
   * @param {Function} streamHandlers.onText - Handles text chunks
   * @param {Function} streamHandlers.onMessage - Handles complete messages
   * @param {Function} streamHandlers.onToolUse - Handles tool use requests
   * @returns {Promise<Object>} The final message
   */
  const streamConversation = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    tools
  }, streamHandlers) => {
    // Get system prompt from configuration or use default
    const systemInstruction = getSystemPrompt(promptType);
    const trimmedMessages = limitConversationHistory(messages);

    // Create stream
    const stream = await anthropic.messages.stream({
      model: AppConfig.api.defaultModel,
      max_tokens: AppConfig.api.maxTokens,
      system: systemInstruction,
      messages: trimmedMessages,
      tools: tools && tools.length > 0 ? tools : undefined
    });

    // Set up event handlers
    if (streamHandlers.onText) {
      stream.on('text', streamHandlers.onText);
    }

    if (streamHandlers.onMessage) {
      stream.on('message', streamHandlers.onMessage);
    }

    if (streamHandlers.onContentBlock) {
      stream.on('contentBlock', streamHandlers.onContentBlock);
    }

    // Wait for final message
    const finalMessage = await stream.finalMessage();

    // Process tool use requests
    if (streamHandlers.onToolUse && finalMessage.content) {
      for (const content of finalMessage.content) {
        if (content.type === "tool_use") {
          await streamHandlers.onToolUse(content);
        }
      }
    }

    return finalMessage;
  };

  /**
   * Summarizes older conversation messages into a compact running summary.
   * @param {Object} params - Summary parameters
   * @param {string} params.previousSummary - Existing summary text
   * @param {Array} params.messages - Messages to fold into the summary
   * @returns {Promise<string>} Compact summary text
   */
  const summarizeConversation = async ({ previousSummary = '', messages = [] } = {}) => {
    if (!Array.isArray(messages) || messages.length === 0) {
      return previousSummary || '';
    }

    const summaryPrompt = buildSummaryPrompt(previousSummary, messages);
    const summaryResponse = await anthropic.messages.create({
      model: AppConfig.api.defaultModel,
      max_tokens: AppConfig.api.summaryMaxTokens,
      system: 'You summarize shopping assistant conversations into a short, durable memory for later turns.',
      messages: [{ role: 'user', content: summaryPrompt }],
    });

    const summaryText = extractTextFromContent(summaryResponse.content).trim();
    return summaryText || previousSummary || '';
  };

  /**
   * Gets the system prompt content for a given prompt type
   * @param {string} promptType - The prompt type to retrieve
   * @returns {string} The system prompt content
   */
  const getSystemPrompt = (promptType) => {
    return systemPrompts.systemPrompts[promptType]?.content ||
      systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;
  };

  const buildSummaryPrompt = (previousSummary, messages) => {
    const formattedMessages = messages
      .map((message, index) => `${index + 1}. ${message.role}: ${formatSummaryContent(message.content)}`)
      .join('\n');

    return [
      'Create a compact running summary for the next chat turn.',
      'Keep only durable facts: user goals, preferences, cart state, product names, policy details, tool results, auth status, and unresolved questions.',
      'Do not include filler, greetings, or repeated wording.',
      'Use plain text only and keep it concise, ideally under 900 characters.',
      previousSummary ? `Existing summary:\n${previousSummary}` : 'Existing summary: none.',
      `New messages to merge:\n${formattedMessages}`,
      'Return only the updated summary.'
    ].join('\n\n');
  };

  const formatSummaryContent = (content) => {
    if (Array.isArray(content)) {
      return content.map((block) => {
        if (block?.type === 'text') {
          return block.text || '';
        }

        if (block?.type === 'tool_use') {
          return `tool use ${block.name || 'unknown'} ${safeStringify(block.input)}`;
        }

        if (block?.type === 'tool_result') {
          return `tool result ${safeStringify(block.content)}`;
        }

        return safeStringify(block);
      }).join(' ');
    }

    if (typeof content === 'string') {
      return content;
    }

    return safeStringify(content);
  };

  const extractTextFromContent = (content) => {
    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join(' ');
  };

  const safeStringify = (value) => {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (!serializedValue) {
        return '';
      }

      return serializedValue.length > 400
        ? `${serializedValue.slice(0, 400)}...`
        : serializedValue;
    } catch {
      return '';
    }
  };

  return {
    streamConversation,
    getSystemPrompt,
    summarizeConversation
  };
}

export default {
  createClaudeService
};
