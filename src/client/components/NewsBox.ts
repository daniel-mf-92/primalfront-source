import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { NewsItem } from "../../core/ApiSchemas";
import { getNews } from "../Api";
import { renderMarkdown } from "../Markdown";
import { translateText } from "../Utils";

export type { NewsItem };

const DISMISSED_NEWS_KEY = "dismissedNewsItems";
const FIREFOX_PERFORMANCE_WARNING_ID = "firefox-performance-issues-2026";
const CYCLE_INTERVAL_MS = 5000;

function currentUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

export function isFirefoxLikeBrowser(
  userAgent: string = currentUserAgent(),
): boolean {
  return /firefox|fxios|waterfox|librewolf|iceweasel|seamonkey|palemoon/i.test(
    userAgent,
  );
}

function getDismissedIds(): Set<string> {
  const raw = localStorage.getItem(DISMISSED_NEWS_KEY);
  if (raw) return new Set(JSON.parse(raw));
  return new Set();
}

function saveDismissedIds(ids: Set<string>): void {
  localStorage.setItem(DISMISSED_NEWS_KEY, JSON.stringify([...ids]));
}

export function getApplicableNewsItems(
  items: NewsItem[],
  userAgent: string = currentUserAgent(),
): NewsItem[] {
  return items.filter((item) => {
    if (item.id === FIREFOX_PERFORMANCE_WARNING_ID) {
      return isFirefoxLikeBrowser(userAgent);
    }
    return true;
  });
}

export function getVisibleNewsItems(
  items: NewsItem[],
  userAgent: string = currentUserAgent(),
): NewsItem[] {
  const dismissed = getDismissedIds();
  return getApplicableNewsItems(items, userAgent).filter(
    (item) => !dismissed.has(item.id),
  );
}

const typeLabelKeys: Record<string, string> = {
  tournament: "news_box.tournament",
  tutorial: "news_box.tutorial",
  announcement: "news_box.news",
  warning: "news_box.warning",
};

// Civ parchment palette: solid ink-on-color badges that read on the light card.
const typeLabelColors: Record<string, string> = {
  tournament: "bg-gold text-surface-0",
  tutorial: "bg-teal text-surface-3",
  announcement: "bg-gain text-surface-3",
  warning: "bg-loss text-surface-3",
};

@customElement("news-box")
export class NewsBox extends LitElement {
  @state() private items: NewsItem[] = [];
  @state() private activeIndex = 0;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadNews();
  }

  private async loadNews() {
    try {
      const allItems = await getNews();
      // Reset stale dismissed list when all items would be hidden
      const applicable = getApplicableNewsItems(allItems);
      const visible = getVisibleNewsItems(allItems);
      if (visible.length === 0 && applicable.length > 0) {
        localStorage.removeItem(DISMISSED_NEWS_KEY);
        this.items = applicable;
      } else {
        this.items = visible;
      }
      this.startCycle();
    } catch (e) {
      console.error(e);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopCycle();
  }

  private startCycle() {
    this.stopCycle();
    if (this.items.length > 1) {
      this.cycleTimer = setInterval(() => {
        this.activeIndex = (this.activeIndex + 1) % this.items.length;
      }, CYCLE_INTERVAL_MS);
    }
  }

  private stopCycle() {
    if (this.cycleTimer !== null) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  private dismiss(id: string) {
    const dismissed = getDismissedIds();
    dismissed.add(id);
    saveDismissedIds(dismissed);
    this.items = this.items.filter((item) => item.id !== id);
    if (this.activeIndex >= this.items.length) {
      this.activeIndex = 0;
    }
    this.startCycle();
  }

  private goTo(index: number) {
    this.activeIndex = index;
    this.startCycle();
  }

  render() {
    if (this.items.length === 0) return nothing;

    const item = this.items[this.activeIndex];

    return html`
      <div
        class="px-2 py-2 bg-surface border-y border-gold-deep lg:border lg:border-gold-deep lg:rounded-xl lg:p-3"
      >
        <div class="flex items-center gap-3">
          <span
            class="shrink-0 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded ${typeLabelColors[
              item.type
            ] ?? typeLabelColors["announcement"]}"
            >${translateText(
              typeLabelKeys[item.type] ?? typeLabelKeys["announcement"],
            )}</span
          >
          <div class="flex-1 min-w-0">
            ${item.url
              ? html`<a
                  href="${item.url}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm font-semibold text-text hover:text-teal transition-colors truncate block"
                  >${item.title}</a
                >`
              : html`<span
                  class="text-sm font-semibold text-text truncate block"
                  >${item.title}</span
                >`}
            <span
              class="text-xs text-text-dim block [&_a]:text-teal [&_a]:underline [&_a:hover]:text-teal-deep"
              >${renderMarkdown(
                item.descriptionTranslationKey
                  ? translateText(item.descriptionTranslationKey)
                  : (item.description ?? ""),
              )}</span
            >
          </div>
          ${this.items.length > 1
            ? html`
                <div class="flex gap-1 shrink-0">
                  ${this.items.map(
                    (_, i) => html`
                      <button
                        @click=${() => this.goTo(i)}
                        class="w-1.5 h-1.5 rounded-full transition-colors ${i ===
                        this.activeIndex
                          ? "bg-gold-deep"
                          : "bg-text-lo/40 hover:bg-text-lo/70"}"
                        aria-label="${translateText("news_box.go_to_item", {
                          num: i + 1,
                        })}"
                      ></button>
                    `,
                  )}
                </div>
              `
            : nothing}
          <button
            @click=${() => this.dismiss(item.id)}
            class="shrink-0 p-0.5 text-text-lo hover:text-text transition-colors"
            aria-label="${translateText("news_box.dismiss")}"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              class="w-3.5 h-3.5"
            >
              <path
                d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>
      </div>
    `;
  }
}
