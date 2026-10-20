import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { documentStylesSheet } from "./SharedStyles";

export type OModalTab = { key: string; label: string };

@customElement("o-modal")
export class OModal extends LitElement {
  static styles = [documentStylesSheet()];

  @state() public isModalOpen = false;

  static openCount = 0;

  @property({ type: Boolean })
  public inline = false;

  @property({ type: Boolean })
  public alwaysMaximized = false;

  @property({ type: Boolean })
  public hideCloseButton = false;

  @property({ type: String })
  public title = "";

  @property({ type: Boolean })
  public hideHeader = false;

  @property({ type: String })
  public maxWidth = "";

  @property({ type: Array })
  public tabs: OModalTab[] = [];

  @property({ type: String })
  public activeTab = "";

  @property({ attribute: false })
  public onTabChange?: (key: string) => void;

  public onClose?: () => void;

  public open() {
    if (!this.isModalOpen) {
      if (!this.inline) {
        OModal.openCount = OModal.openCount + 1;
        if (OModal.openCount === 1) document.body.style.overflow = "hidden";
      }
      this.isModalOpen = true;
    }
  }

  public close() {
    if (this.isModalOpen) {
      this.isModalOpen = false;
      this.onClose?.();
      if (!this.inline) {
        OModal.openCount = Math.max(0, OModal.openCount - 1);
        if (OModal.openCount === 0) document.body.style.overflow = "";
      }
    }
  }

  disconnectedCallback() {
    // Ensure global counter is decremented if this modal is removed while open.
    if (this.isModalOpen && !this.inline) {
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
    }
    super.disconnectedCallback();
  }

  private handleTabClick(key: string) {
    this.onTabChange?.(key);
  }

  private renderTabs() {
    return html`
      <div
        role="tablist"
        class="pf-modal-tabs flex justify-center px-4 lg:px-6 gap-1 shrink-0"
      >
        ${this.tabs.map((tab) => {
          const active = this.activeTab === tab.key;
          return html`
            <button
              type="button"
              role="tab"
              data-key=${tab.key}
              aria-selected=${active}
              class="pf-modal-tab px-4 py-3 text-sm font-bold uppercase tracking-wider transition-all relative cursor-pointer ${active
                ? "is-active"
                : ""}"
              style=${active
                ? "font-family: var(--font-display); color: var(--age-accent);"
                : ""}
              @click=${() => this.handleTabClick(tab.key)}
            >
              ${tab.label}
              ${active
                ? html`<div
                    class="pf-modal-tab-underline absolute bottom-0 left-0 right-0 h-0.5"
                  ></div>`
                : ""}
            </button>
          `;
        })}
      </div>
    `;
  }

  render() {
    const shouldRender = this.isModalOpen || this.inline;
    if (!shouldRender) {
      return html``;
    }

    const backdropClass = this.inline
      ? "relative z-10 w-full h-full flex items-stretch bg-transparent"
      : "pf-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden";

    const wrapperClass = this.inline
      ? "relative flex flex-col w-full h-full m-0 max-w-full max-h-none shadow-none"
      : `pf-modal-shell relative flex flex-col w-full h-full lg:w-[90%] lg:h-auto lg:min-w-[400px] lg:max-w-[900px] lg:m-8 lg:max-h-[calc(100vh-4rem)] ${
          this.alwaysMaximized ? "h-auto" : ""
        }`;
    const wrapperStyle =
      !this.inline && this.maxWidth ? `max-width: ${this.maxWidth};` : "";

    const hasTabs = this.tabs.length > 0;
    const sectionClass = this.inline
      ? "relative flex-1 min-h-0 flex flex-col text-[var(--text)] bg-transparent overflow-hidden"
      : "pf-modal-panel relative flex-1 min-h-0 flex flex-col text-[var(--text)] overflow-hidden";

    return html`
      <aside
        class="${backdropClass}"
        @click=${this.inline ? null : () => this.close()}
      >
        <div
          @click=${(e: Event) => e.stopPropagation()}
          class="${wrapperClass}"
          style="${wrapperStyle}"
        >
          ${this.inline || this.hideCloseButton
            ? html``
            : html`<button
                class="pf-modal-close absolute top-4 right-4 z-10"
                aria-label="Close"
                @click=${() => this.close()}
              >
                ✕
              </button>`}
          ${!this.hideHeader && this.title
            ? html`<div class="pf-modal-title px-6 pt-5 pb-3">
                ${this.title}
              </div>`
            : html``}
          <section class="${sectionClass}">
            <slot name="header"></slot>
            ${hasTabs ? this.renderTabs() : html``}
            <div class="flex-1 min-h-0 overflow-y-auto">
              <slot></slot>
            </div>
          </section>
        </div>
      </aside>
    `;
  }
}
