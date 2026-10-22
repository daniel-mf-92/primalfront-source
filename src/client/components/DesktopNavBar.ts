import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { ACCOUNTS_ENABLED } from "../Features";
import { NavNotificationsController } from "./NavNotificationsController";

@customElement("desktop-nav-bar")
export class DesktopNavBar extends LitElement {
  private _notifications = new NavNotificationsController(this);

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    const current = window.currentPageId;
    if (current) {
      // Wait for render
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
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <nav
        class="nav-shell hidden lg:flex w-full items-center justify-center gap-8 py-4 shrink-0 z-50"
      >
        <div class="flex flex-col items-center justify-center">
          <div class="h-8">
            <span class="pf-wordmark">Primalfront</span>
          </div>
          <div
            id="game-version"
            class="l-header__highlightText text-center"
          ></div>
        </div>
        <button
          class="nav-menu-item ${currentPage === "page-play"
            ? "active"
            : ""} nav-tab"
          data-page="page-play"
          data-i18n="main.play"
        ></button>
        <!-- Desktop Navigation Menu Items -->
        <div class="relative">
          <button
            class="nav-menu-item ${currentPage === "page-news"
              ? "active"
              : ""} nav-tab"
            data-page="page-news"
            data-i18n="main.news"
            @click=${this._notifications.onNewsClick}
          ></button>
          ${this._notifications.showNewsDot()
            ? html`
                <span
                  class="nav-dot nav-dot--ping absolute -top-1 -right-1 animate-ping"
                ></span>
                <span class="nav-dot absolute -top-1 -right-1"></span>
              `
            : ""}
        </div>
        ${ACCOUNTS_ENABLED
          ? html`<div class="relative no-crazygames">
              <button
                class="nav-menu-item ${currentPage === "page-item-store"
                  ? "active"
                  : ""} nav-tab"
                data-page="page-item-store"
                data-i18n="main.store"
                @click=${this._notifications.onStoreClick}
              ></button>
              ${this._notifications.showStoreDot()
                ? html`
                    <span
                      class="nav-dot nav-dot--ping absolute -top-1 -right-1 animate-ping"
                    ></span>
                    <span class="nav-dot absolute -top-1 -right-1"></span>
                  `
                : ""}
            </div>`
          : ""}
        <button
          class="nav-menu-item nav-tab"
          data-page="page-settings"
          data-i18n="main.settings"
        ></button>
        <button
          class="nav-menu-item nav-tab"
          data-page="page-leaderboard"
          data-i18n="main.leaderboard"
        ></button>
        ${ACCOUNTS_ENABLED
          ? html`<button
              class="no-crazygames nav-menu-item nav-tab"
              data-page="page-clan"
              data-i18n="main.clans"
            ></button>`
          : ""}
        <div class="relative">
          <button
            class="nav-menu-item nav-tab"
            data-page="page-help"
            data-i18n="main.help"
            @click=${this._notifications.onHelpClick}
          ></button>
          ${this._notifications.showHelpDot()
            ? html`
                <span
                  class="nav-dot nav-dot--info nav-dot--ping absolute -top-1 -right-1 animate-ping"
                ></span>
                <span
                  class="nav-dot nav-dot--info absolute -top-1 -right-1"
                ></span>
              `
            : ""}
        </div>
        ${ACCOUNTS_ENABLED
          ? html`<button
              id="nav-account-button"
              class="no-crazygames nav-menu-item nav-account-pill relative h-10 rounded-full overflow-hidden flex items-center justify-center gap-2 px-3 cursor-pointer"
              data-page="page-account"
              data-i18n-aria-label="main.account"
              data-i18n-title="main.account"
            >
              <img
                id="nav-account-avatar"
                class="no-crazygames hidden w-8 h-8 rounded-full object-cover"
                alt=""
                data-i18n-alt="main.discord_avatar_alt"
                referrerpolicy="no-referrer"
              />
              <svg
                id="nav-account-person-icon"
                class="w-5 h-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M20 21a8 8 0 0 0-16 0" />
                <path d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
              </svg>
              <span
                id="nav-account-email-badge"
                class="hidden absolute bottom-1 right-1 w-4 h-4 rounded-full bg-slate-900/80 border border-white/20 flex items-center justify-center"
                aria-hidden="true"
              >
                <svg
                  class="w-2.5 h-2.5 text-white/80"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M4 4h16v16H4z" opacity="0" />
                  <path d="M4 6h16v12H4z" />
                  <path d="m4 7 8 6 8-6" />
                </svg>
              </span>
              <span
                id="nav-account-signin-text"
                class="text-xs font-bold tracking-widest"
                data-i18n="main.sign_in"
              >
              </span>
            </button>`
          : ""}
      </nav>
    `;
  }
}
