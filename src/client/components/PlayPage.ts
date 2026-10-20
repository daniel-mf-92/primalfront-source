import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import "./NewsBox";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="page-play"
        class="flex flex-col gap-2 w-full px-0 lg:px-4 min-h-0"
      >
        <token-login class="absolute"></token-login>

        <!-- Mobile: Fixed top bar -->
        <div
          class="lg:hidden fixed left-0 right-0 top-0 z-40 pt-[env(safe-area-inset-top)] bg-surface-1/85 backdrop-blur-md border-b border-hairline shadow-1"
        >
          <div
            class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-14 px-2 gap-2"
          >
            <button
              id="hamburger-btn"
              class="col-start-1 justify-self-start h-10 shrink-0 aspect-[4/3] flex text-white/90 rounded-md items-center justify-center transition-colors"
              data-i18n-aria-label="main.menu"
              aria-expanded="false"
              aria-controls="sidebar-menu"
              aria-haspopup="dialog"
              data-i18n-title="main.menu"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="size-8"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>

            <div class="col-start-2 flex items-center justify-center min-w-0">
              <span class="pf-mobile-wordmark">Primalfront</span>
            </div>

            <div
              aria-hidden="true"
              class="col-start-3 justify-self-end h-10 shrink-0 aspect-[4/3]"
            ></div>
          </div>
        </div>

        <div class="pf-home-shell">
          <!-- Mobile: spacer for fixed top bar -->
          <div
            class="lg:hidden h-[calc(env(safe-area-inset-top)+56px)] -mb-2"
          ></div>

          <section class="pf-player-strip">
            <div class="pf-player-strip__identity">
              <span
                class="pf-player-strip__label"
                data-i18n="mode_selector.playing_as"
              ></span>
              <username-input
                class="pf-player-strip__username"
              ></username-input>
            </div>
            <div class="pf-player-strip__cosmetics">
              <pattern-input
                id="pattern-input-home"
                adaptive-size
                show-select-label
                class="pf-player-strip__cosmetic"
              ></pattern-input>
              <flag-input
                id="flag-input-home"
                show-select-label
                class="pf-player-strip__cosmetic pf-player-strip__flag"
              ></flag-input>
            </div>
          </section>

          <game-mode-selector></game-mode-selector>
        </div>

        <!-- Announcements follow the play decision so they cannot displace the
             primary action or the first public match on small screens. -->
        <news-box class="block mt-2 px-4 sm:px-0"></news-box>
      </div>
    `;
  }
}
