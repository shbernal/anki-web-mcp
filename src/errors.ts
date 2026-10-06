import { ProtobufError } from "./ankiweb/protobuf.js";

export const ISSUES_URL = "https://github.com/shbernal/anki-web-mcp/issues";

/**
 * An error whose message is written for the person at the other end of the
 * assistant: it says what went wrong and what to do. A tool that throws one
 * returns its message as is. Anything else is logged and summarized.
 */
export class ToolError extends Error {
  override name = "ToolError";
}

/** Session cookie values as they appear in a `Cookie` header or a message. */
const COOKIE_VALUE = /\b(?<name>ankiweb|has_auth)=[^;\s"']+/gu;
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Masks any session cookie value in `text`. */
export function redact(text: string): string {
  return text.replaceAll(COOKIE_VALUE, "$<name>=<redacted>");
}

function causeCode(error: Readonly<Error>): string | undefined {
  const { cause } = error;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }
  return typeof cause.code === "string" ? cause.code : undefined;
}

/** The message a tool returns for `error`, which says what to do when this server knows. */
export function describeError(error: unknown, tool: string): string {
  if (error instanceof ToolError) {
    return redact(error.message);
  }
  if (error instanceof ProtobufError) {
    // A payload that no longer decodes is the first sign of AnkiWeb changing.
    return `AnkiWeb answered in a way this server does not understand (${error.message}). The site may have changed; please report it at ${ISSUES_URL}.`;
  }
  if (error instanceof Error) {
    const code = causeCode(error);
    if (code !== undefined && NETWORK_ERROR_CODES.has(code)) {
      return `Could not reach AnkiWeb (${code}). Check the network connection and try again.`;
    }
    if (error.name === "TimeoutError") {
      return "AnkiWeb did not answer in time. Try again in a moment.";
    }
  }
  return `${tool} failed unexpectedly. The details are in the server's log; please report them at ${ISSUES_URL}.`;
}

export interface ErrorResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
}

/**
 * Wraps a tool handler so that whatever it throws comes back as a tool error
 * the assistant can act on. An error this server did not anticipate is logged
 * to stderr with its stack, cookie values masked, and summarized in the
 * result rather than quoted.
 */
export function guarded<Args extends unknown[], Result>(
  tool: string,
  handler: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result | ErrorResult> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const text = describeError(error, tool);
      if (!(error instanceof ToolError)) {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.error(`anki-web-mcp: ${tool}: ${redact(detail)}`);
      }
      return { content: [{ type: "text", text }], isError: true };
    }
  };
}
