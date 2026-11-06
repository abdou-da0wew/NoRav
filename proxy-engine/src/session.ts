import hammerhead from "testcafe-hammerhead";
import { logEvent } from "./logger.js";

interface PageErrorContext {
  readonly dest?: {
    readonly url?: string;
  };
  closeWithError(statusCode: number, responseBody?: string): void;
}

export class NoRavSession extends hammerhead.Session {
  constructor() {
    super([], {
      allowMultipleWindows: true,
      disablePageCaching: false,
      requestTimeout: {
        page: 60_000,
        ajax: 60_000,
      },
    });
  }

  override getIframePayloadScript(): Promise<string> {
    return Promise.resolve("");
  }

  override getPayloadScript(): Promise<string> {
    return Promise.resolve(
      [
        ";(function(){",
        "var notify=function(){try{var path=location.pathname||'';var cut=path.indexOf('/',1);if(cut<0)return;var value=path.slice(cut+1)+location.search+location.hash;if(value.indexOf('http://')===0||value.indexOf('https://')===0)parent.postMessage({type:'norav:navigation',url:value},'*')}catch(e){}};",
        "var push=history.pushState;history.pushState=function(){var result=push.apply(this,arguments);setTimeout(notify,0);return result};",
        "var replace=history.replaceState;history.replaceState=function(){var result=replace.apply(this,arguments);setTimeout(notify,0);return result};",
        "addEventListener('popstate',notify);addEventListener('hashchange',notify);addEventListener('load',notify);setTimeout(notify,0);",
        "})();",
      ].join("\n"),
    );
  }

  override handleFileDownload(): void {}

  getAuthCredentials(): Record<string, never> {
    return {};
  }

  handlePageError(context: unknown, error: unknown): void {
    if (
      typeof context !== "object" ||
      context === null ||
      !("closeWithError" in context) ||
      typeof context.closeWithError !== "function"
    ) {
      logEvent("upstream_page_error", {
        host: "unknown",
        error: error instanceof Error ? error.name : "UnknownError",
        responseClosed: false,
      });
      return;
    }

    const pageContext = context as PageErrorContext;
    let host = "unknown";

    try {
      host = new URL(pageContext.dest?.url ?? "").hostname || host;
    } catch {
      // Keep the host label non-sensitive when the target URL is malformed.
    }

    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : error instanceof Error
          ? error.name
          : typeof error === "string"
            ? "UPSTREAM_REQUEST_FAILED"
            : "UnknownError";
    const errorMessage =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof error.message === "string"
            ? error.message
            : "Upstream request failed";
    const safeMessage = errorMessage
      .replace(/https?:\/\/[^\s"'<>]+/gi, "<destination>")
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 240);

    logEvent("upstream_page_error", {
      host,
      error: errorCode,
      message: safeMessage,
      responseClosed: true,
    });
    pageContext.closeWithError(
      502,
      "The upstream website could not be loaded. Please try again.",
    );
  }

  handleAttachment(_options: { isOpenedInNewWindow: boolean }): void {}

  disableCrossDomainForNoRav(): void {
    const runtimeSession = this as NoRavSession & {
      disableCrossDomain?: () => void;
    };
    runtimeSession.disableCrossDomain?.();
  }
}
