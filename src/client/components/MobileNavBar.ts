import { html, LitElement, TemplateResult } from "lit";
import { ACCOUNTS_ENABLED } from "../Features";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("mobile-nav-bar")
export class MobileNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    const current = window.currentPageId;
    if (current) {
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      const inner = el.querySelector("button");
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
        inner?.classList.add("active");
      } else {
        el.classList.remove("active");
        inner?.classList.remove("active");
      }
    });
  }

  private _renderDot(variant: "alert" | "info"): TemplateResult {
    const mod = variant === "info" ? " nav-dot--info" : "";
    return html`<span
      class="relative ml-2 shrink-0 -mt-2 w-2 h-2 overflow-hidden"
      aria-hidden="true"
    >
      <span
        class="nav-dot${mod} nav-dot--ping absolute inset-0 animate-ping"
      ></span>
      <span class="nav-dot${mod} absolute inset-0"></span>
    </span>`;
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <!-- Border Segments (Custom right border with gap for button) -->
      <div
        class="absolute right-0 top-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>
      <div
        class="absolute right-0 bottom-0 w-px bg-transparent"
        style="height: calc(50% - 64px)"
      ></div>

      <div
        class="flex-1 w-full flex flex-col justify-start overflow-y-auto lg:pt-[clamp(1rem,3vh,4rem)] lg:pb-[clamp(0.5rem,2vh,2rem)] lg:px-[clamp(1rem,1.5vw,2rem)] pt-4 pb-4 px-5 gap-4 lg:gap-[clamp(1rem,3vh,3rem)]"
      >
        <!-- Logo + Menu -->
        <div
          class="flex flex-col text-malibu-blue mb-4 ml-[clamp(0.2rem,0.4vw,0.4vh)]"
        >
          <div class="flex flex-col items-center gap-1">
            <img
              src=${assetUrl("images/PrimalfrontLogo.svg")}
              alt="Primalfront"
              class="w-auto h-auto max-w-[220px] max-h-[4.5rem]"
            />
            <div
              id="game-version"
              class="l-header__highlightText text-center"
            ></div>
          </div>
        </div>
        <!-- Mobile Navigation Menu Items -->
        <button
          class="nav-menu-item mobile-nav-tab text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)] ${currentPage ===
          "page-play"
            ? "active"
            : ""}"
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <div
          class="nav-menu-item flex items-center w-full min-w-0 overflow-hidden cursor-pointer"
          data-page="page-news"
          @click=${this._notifications.onNewsClick}
        >
          <button
            class="mobile-nav-tab flex-1 min-w-0 text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
            data-i18n="main.news"
          ></button>
          ${this._notifications.showNewsDot() ? this._renderDot("alert") : ""}
        </div>
        <button
          class="nav-menu-item mobile-nav-tab text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-leaderboard"
          data-i18n="main.leaderboard"
        ></button>
        ${ACCOUNTS_ENABLED
          ? html`<button
          class="no-crazygames nav-menu-item mobile-nav-tab text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-clan"
          data-i18n="main.clans"
        ></button>`
          : ""}
        ${ACCOUNTS_ENABLED
          ? html`<div
          class="no-crazygames nav-menu-item flex items-center w-full min-w-0 overflow-hidden cursor-pointer"
          data-page="page-item-store"
          @click=${this._notifications.onStoreClick}
        >
          <button
            class="mobile-nav-tab flex-1 min-w-0 text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
            data-i18n="main.store"
          ></button>
          ${this._notifications.showStoreDot() ? this._renderDot("alert") : ""}
        </div>`
          : ""}
        <button
          class="nav-menu-item mobile-nav-tab text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-settings"
          data-i18n="main.settings"
        ></button>
        ${ACCOUNTS_ENABLED
          ? html`<button
          class="no-crazygames nav-menu-item mobile-nav-tab text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
          data-page="page-account"
          data-i18n="main.account"
        ></button>`
          : ""}
        <div
          class="nav-menu-item flex items-center w-full min-w-0 overflow-hidden cursor-pointer"
          data-page="page-help"
          @click=${this._notifications.onHelpClick}
        >
          <button
            class="mobile-nav-tab flex-1 min-w-0 text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]"
            data-i18n="main.help"
          ></button>
          ${this._notifications.showHelpDot() ? this._renderDot("info") : ""}
        </div>
        <div
          class="flex flex-col w-full mt-auto [.in-game_&]:hidden items-end justify-end pt-4 border-t border-white/10"
        ></div>
      </div>
    `;
  }
}
