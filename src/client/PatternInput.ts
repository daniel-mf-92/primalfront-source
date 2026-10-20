import { LitElement, html } from "lit";
import { ACCOUNTS_ENABLED } from "./Features";
import { customElement, property, state } from "lit/decorators.js";
import {
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
} from "../core/game/UserSettings";
import { PlayerPattern, PlayerSkin } from "../core/Schemas";
import { renderPatternPreview } from "./components/PatternPreview";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

@customElement("pattern-input")
export class PatternInput extends LitElement {
  @state() public pattern: PlayerPattern | null = null;
  @state() public skin: PlayerSkin | null = null;
  @state() public selectedColor: string | null = null;
  @state() private isLoading: boolean = true;

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  @property({ type: Boolean, attribute: "adaptive-size" })
  public adaptiveSize: boolean = false;

  private _abortController: AbortController | null = null;

  private _onCosmeticSelected = async () => {
    const cosmetics = await getPlayerCosmetics();
    this.selectedColor = cosmetics.color?.color ?? null;
    this.pattern = cosmetics.pattern ?? null;
    this.skin = cosmetics.skin ?? null;
  };

  private onInputClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("pattern-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  async connectedCallback() {
    super.connectedCallback();
    this._abortController = new AbortController();
    this.isLoading = true;
    const cosmetics = await getPlayerCosmetics();
    this.selectedColor = cosmetics.color?.color ?? null;
    this.pattern = cosmetics.pattern ?? null;
    this.skin = cosmetics.skin ?? null;
    if (!this.isConnected) return;
    this.isLoading = false;
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      this._onCosmeticSelected,
      {
        signal: this._abortController.signal,
      },
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  createRenderRoot() {
    return this;
  }

  private getIsDefaultPattern(): boolean {
    return (
      this.pattern === null && this.skin === null && this.selectedColor === null
    );
  }

  private shouldShowSelectLabel(): boolean {
    return this.showSelectLabel && this.getIsDefaultPattern();
  }

  private applyAdaptiveSize(): void {
    if (!this.adaptiveSize) {
      this.style.removeProperty("width");
      this.style.removeProperty("height");
      return;
    }

    const showSelect = this.showSelectLabel && this.getIsDefaultPattern();
    this.style.setProperty("height", "2.5rem");
    this.style.setProperty(
      "width",
      showSelect ? "clamp(4rem, 18vw, 5.5rem)" : "2.5rem",
    );
  }

  protected updated(): void {
    this.applyAdaptiveSize();
  }

  render() {
    if (!ACCOUNTS_ENABLED || crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }

    const showSelect = this.shouldShowSelectLabel();
    const buttonTitle = translateText("territory_patterns.title");

    // Show loading state
    if (this.isLoading) {
      return html`
        <button
          id="pattern-input"
          class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 bg-[var(--surface-1)] border border-[var(--hairline)] rounded-[var(--radius-sm)] overflow-hidden"
          disabled
        >
          <span
            class="w-6 h-6 border-4 border-[var(--hairline)] border-t-[var(--age-accent)] rounded-full animate-spin"
          ></span>
        </button>
      `;
    }

    // Skin takes precedence over pattern (mutually exclusive in-game too).
    let previewContent;
    if (this.skin) {
      previewContent = html`<img
        src=${this.skin.url}
        alt=${this.skin.name}
        class="pointer-events-none"
        draggable="false"
        loading="lazy"
      />`;
    } else if (this.pattern) {
      previewContent = renderPatternPreview(this.pattern, 128, 128);
    } else {
      previewContent = renderPatternPreview(null, 128, 128);
    }

    return html`
      <button
        id="pattern-input"
        class="pattern-btn m-0 p-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 bg-[color-mix(in_srgb,var(--surface-2)_62%,transparent)] hover:bg-[var(--surface-2)] active:scale-[0.98] border border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-action-card-hover)] rounded-[var(--radius-sm)] overflow-hidden"
        title=${buttonTitle}
        @click=${this.onInputClick}
      >
        <span
          class=${showSelect
            ? "hidden"
            : "w-full h-full overflow-hidden flex items-center justify-center [&>img]:object-cover [&>img]:w-full [&>img]:h-full [&>img]:pointer-events-none"}
        >
          ${!showSelect ? previewContent : null}
        </span>
        ${showSelect
          ? html`<span
              class="${this.adaptiveSize
                ? "text-[10px] leading-none px-1"
                : "text-[10px] leading-none break-words px-1"} font-black tracking-[0.08em] text-[var(--text)] uppercase w-full text-center"
            >
              <span class="lg:hidden">SKIN</span>
              <span class="hidden lg:inline"
                >${translateText("territory_patterns.select_skin")}</span
              >
            </span>`
          : null}
      </button>
    `;
  }
}
