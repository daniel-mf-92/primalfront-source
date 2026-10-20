import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import medalIconRaw from "../../../../resources/images/MedalIconWhite.svg?raw";
import { Difficulty, GameMapType } from "../../../core/game/Game";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import { translateText } from "../../Utils";
import { starIcon } from "./MapFavorites";

const medalMaskUrl = `url('data:image/svg+xml;utf8,${encodeURIComponent(medalIconRaw)}') no-repeat center / contain`;

@customElement("map-display")
export class MapDisplay extends LitElement {
  @property({ type: String }) mapKey = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) translation: string = "";
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) favorite = false;
  @property({ attribute: false }) wins: Set<Difficulty> = new Set();
  @property({ attribute: false }) onToggleFavorite?: () => void;
  @state() private mapWebpPath: string | null = null;
  @state() private mapName: string | null = null;
  @state() private isLoading = true;
  @state() private hasNations = true;
  private observer: IntersectionObserver | null = null;
  private dataLoaded = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !this.dataLoaded) {
          this.dataLoaded = true;
          this.loadMapData();
          this.observer?.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
    super.disconnectedCallback();
  }

  updated(changedProperties: Map<string, unknown>) {
    // If this element is reused for a different map, reload its data —
    // otherwise it keeps showing the previous map's thumbnail.
    const previousMapKey = changedProperties.get("mapKey");
    if (
      changedProperties.has("mapKey") &&
      previousMapKey !== undefined &&
      previousMapKey !== this.mapKey &&
      this.dataLoaded
    ) {
      this.loadMapData();
    }
  }

  private async loadMapData() {
    if (!this.mapKey) return;

    try {
      this.isLoading = true;
      const mapValue = GameMapType[this.mapKey as keyof typeof GameMapType];
      const data = terrainMapFileLoader.getMapData(mapValue);
      this.mapWebpPath = data.webpPath;
      const manifest = await data.manifest();
      this.mapName = manifest.name;
      this.hasNations =
        Array.isArray(manifest.nations) && manifest.nations.length > 0;
    } catch (error) {
      console.error("Failed to load map data:", error);
    } finally {
      this.isLoading = false;
    }
  }

  private handleKeydown(event: KeyboardEvent) {
    // Trigger the same activation logic as click when Enter or Space is pressed
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Dispatch a click event to maintain compatibility with parent click handlers
      (event.target as HTMLElement).click();
    }
  }

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  private handleToggleFavorite(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.onToggleFavorite?.();
  }

  private renderFavoriteButton() {
    if (!this.onToggleFavorite) return null;
    return html`<button
      type="button"
      @click=${this.handleToggleFavorite}
      @keydown=${(e: KeyboardEvent) => e.stopPropagation()}
      aria-pressed=${this.favorite}
      aria-label=${translateText(
        this.favorite ? "map_component.unfavorite" : "map_component.favorite",
      )}
      title=${translateText(
        this.favorite ? "map_component.unfavorite" : "map_component.favorite",
      )}
      class="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--surface-0)_78%,transparent)] border border-[var(--hairline)] backdrop-blur-sm transition-all duration-200 active:scale-90 ${this
        .favorite
        ? "opacity-100 text-[var(--gold-bright)]"
        : "opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-[var(--gold-bright)]"}"
    >
      ${starIcon(this.favorite, "w-4 h-4")}
    </button>`;
  }

  render() {
    return html`
      <div
        role="button"
        tabindex="0"
        aria-selected="${this.selected}"
        aria-label="${this.translation ?? this.mapName ?? this.mapKey}"
        @keydown="${this.handleKeydown}"
        class="pf-config-card w-full h-full p-3 flex flex-col items-center justify-between cursor-pointer transition-all duration-200 gap-3 group ${this
          .selected
          ? "is-active"
          : ""}"
      >
        ${this.isLoading
          ? html`<div
              class="w-full aspect-[2/1] text-[var(--text-lo)] transition-transform duration-200 rounded-[var(--radius-sm)] bg-[var(--surface-0)] text-xs font-bold uppercase tracking-wider flex items-center justify-center animate-pulse"
            >
              ${translateText("map_component.loading")}
            </div>`
          : this.mapWebpPath
            ? html`<div
                class="pf-map-preview-frame w-full aspect-[2/1] relative overflow-hidden rounded-[var(--radius-sm)]"
              >
                <img
                  src="${this.mapWebpPath}"
                  alt="${this.translation || this.mapName}"
                  draggable="false"
                  loading="lazy"
                  decoding="async"
                  @dragstart=${this.preventImageDrag}
                  class="pf-map-preview-img w-full h-full object-contain"
                />
                ${this.renderFavoriteButton()}
              </div>`
            : html`<div
                class="w-full aspect-[2/1] text-[var(--loss)] transition-transform duration-200 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--loss)_12%,transparent)] text-xs font-bold uppercase tracking-wider flex items-center justify-center"
              >
                ${translateText("map_component.error")}
              </div>`}
        ${this.showMedals && this.hasNations
          ? html`<div class="flex gap-1 justify-center w-full">
              ${this.renderMedals()}
            </div>`
          : null}
        <div class="pf-card-label text-center">
          ${this.translation || this.mapName}
        </div>
      </div>
    `;
  }

  private renderMedals() {
    const medalOrder: Difficulty[] = [
      Difficulty.Easy,
      Difficulty.Medium,
      Difficulty.Hard,
      Difficulty.Impossible,
    ];
    const colors: Record<Difficulty, string> = {
      [Difficulty.Easy]: "var(--medal-easy)",
      [Difficulty.Medium]: "var(--medal-medium)",
      [Difficulty.Hard]: "var(--medal-hard)",
      [Difficulty.Impossible]: "var(--medal-impossible)",
    };
    const wins = this.readWins();
    return medalOrder.map((medal) => {
      const earned = wins.has(medal);
      const mask = medalMaskUrl;
      return html`<div
        class="w-5 h-5 ${earned ? "opacity-100" : "opacity-25"}"
        style="background-color:${colors[
          medal
        ]}; mask: ${mask}; -webkit-mask: ${mask};"
        title=${translateText(`difficulty.${medal.toLowerCase()}`)}
      ></div>`;
    });
  }

  private readWins(): Set<Difficulty> {
    return this.wins ?? new Set();
  }
}
