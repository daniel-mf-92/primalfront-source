import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { assetUrl } from "../../../core/AssetUrls";
import {
  Difficulty,
  GameMapType,
  MapCategory,
  mapCategoryOrder,
  MapInfo,
  maps,
} from "../../../core/game/Game";
import { translateText } from "../../Utils";
import "./MapDisplay";
import { getFavoriteMaps, starIcon, toggleFavoriteMap } from "./MapFavorites";
const randomMap = assetUrl("images/RandomMap.webp");

type MapTab = "featured" | "all" | "favorites";

// Featured grid order: ranked maps first (1 = first), unranked alphabetical.
const featuredMaps: MapInfo[] = maps
  .filter((m) => m.categories.includes("featured"))
  .sort(
    (a, b) =>
      (a.featuredRank ?? Number.MAX_SAFE_INTEGER) -
      (b.featuredRank ?? Number.MAX_SAFE_INTEGER),
  );

function mapsInCategory(category: MapCategory): MapInfo[] {
  return maps.filter((m) => m.categories.includes(category));
}

@customElement("map-picker")
export class MapPicker extends LitElement {
  @property({ type: String }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) randomMapDivider = false;
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @property({ attribute: false }) onSelectRandom?: () => void;
  @state() private activeTab: MapTab = "featured";
  @state() private expandedCategories: Set<string> = new Set();
  @state() private favorites: GameMapType[] = getFavoriteMaps();

  createRenderRoot() {
    return this;
  }

  private handleToggleFavorite(mapValue: GameMapType) {
    this.favorites = toggleFavoriteMap(mapValue);
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
  }

  private handleSelectRandomMap = () => {
    this.onSelectRandom?.();
  };

  private toggleCategory(categoryKey: string) {
    const expanded = new Set(this.expandedCategories);
    if (expanded.has(categoryKey)) {
      expanded.delete(categoryKey);
    } else {
      expanded.add(categoryKey);
    }
    this.expandedCategories = expanded;
  }

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  private getWins(mapValue: GameMapType): Set<Difficulty> {
    return this.mapWins?.get(mapValue) ?? new Set();
  }

  private renderMapCard(map: MapInfo) {
    return html`
      <div
        @click=${() => this.handleMapSelection(map.type)}
        class="cursor-pointer"
      >
        <map-display
          .mapKey=${map.id}
          .selected=${!this.useRandomMap && this.selectedMap === map.type}
          .showMedals=${this.showMedals}
          .wins=${this.getWins(map.type)}
          .favorite=${this.favorites.includes(map.type)}
          .onToggleFavorite=${() => this.handleToggleFavorite(map.type)}
          .translation=${translateText(map.translationKey)}
        ></map-display>
      </div>
    `;
  }

  private renderMapGrid(mapList: MapInfo[]) {
    // Keyed by map so cards keep their identity when the list shifts
    // (e.g. the selected map gets prepended to the featured grid) —
    // positional reuse would leave stale thumbnails behind.
    return html`<div
      class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
    >
      ${repeat(
        mapList,
        (map) => map.id,
        (map) => this.renderMapCard(map),
      )}
    </div>`;
  }

  private renderSectionHeading(label: string) {
    return html`<h4 class="pf-section-kicker mb-4 pl-2">${label}</h4>`;
  }

  private renderCategoryBar(categoryKey: MapCategory, mapList: MapInfo[]) {
    const expanded = this.expandedCategories.has(categoryKey);
    return html`<div class="w-full">
      <button
        type="button"
        aria-expanded=${expanded}
        @click=${() => this.toggleCategory(categoryKey)}
        class="pf-config-card w-full flex items-center justify-between gap-3 px-4 py-3 transition-all duration-200 ${expanded
          ? "is-active"
          : ""}"
      >
        <span
          class="flex items-center gap-3 text-sm font-bold uppercase tracking-wider"
        >
          <svg
            class="w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${expanded
              ? "rotate-90"
              : ""}"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 2l5 4-5 4z" />
          </svg>
          ${translateText(`map_categories.${categoryKey}`)}
        </span>
        <span class="text-xs font-bold text-[var(--text-lo)]"
          >${mapList.length}</span
        >
      </button>
      ${expanded
        ? html`<div class="mt-4">${this.renderMapGrid(mapList)}</div>`
        : null}
    </div>`;
  }

  private renderFeaturedTab() {
    let featuredMapList = featuredMaps;
    const selected = maps.find((m) => m.type === this.selectedMap);
    if (
      !this.useRandomMap &&
      selected !== undefined &&
      !featuredMaps.includes(selected)
    ) {
      featuredMapList = [selected, ...featuredMaps];
    }
    return html`<div class="w-full">
      ${this.renderSectionHeading(translateText("map_categories.featured"))}
      ${this.renderMapGrid(featuredMapList)}
    </div>`;
  }

  private renderAllTab() {
    return html`<div class="space-y-3">
      ${mapCategoryOrder
        .filter((categoryKey) => categoryKey !== "featured")
        .map((categoryKey) =>
          this.renderCategoryBar(categoryKey, mapsInCategory(categoryKey)),
        )}
    </div>`;
  }

  private renderFavoritesTab() {
    if (this.favorites.length === 0) {
      return html`<div
        class="pf-empty-state w-full flex flex-col items-center justify-center gap-3 py-12 px-4 text-center"
      >
        <div class="text-[var(--text-lo)]">${starIcon(false, "w-8 h-8")}</div>
        <p class="text-sm leading-relaxed max-w-xs">
          ${translateText("map_component.favorites_empty")}
        </p>
      </div>`;
    }
    const favoriteMaps = this.favorites
      .map((favorite) => maps.find((m) => m.type === favorite))
      .filter((m) => m !== undefined);
    return html`<div class="w-full">
      ${this.renderSectionHeading(translateText("map_categories.favorites"))}
      ${this.renderMapGrid(favoriteMaps)}
    </div>`;
  }

  private renderActiveTab() {
    switch (this.activeTab) {
      case "all":
        return this.renderAllTab();
      case "favorites":
        return this.renderFavoritesTab();
      default:
        return this.renderFeaturedTab();
    }
  }

  private renderTabButton(tab: MapTab, label: string) {
    const isActive = this.activeTab === tab;
    return html`<button
      type="button"
      role="tab"
      aria-selected=${isActive}
      class="pf-map-tab ${isActive ? "is-active" : ""}"
      @click=${() => (this.activeTab = tab)}
    >
      ${label}
    </button>`;
  }

  render() {
    return html`
      <div class="space-y-8">
        <div class="w-full">
          <div
            role="tablist"
            aria-label="${translateText("map.map")}"
            class="pf-map-tabs"
          >
            ${this.renderTabButton("featured", translateText("map.featured"))}
            ${this.renderTabButton("all", translateText("map.all"))}
            ${this.renderTabButton("favorites", translateText("map.favorites"))}
          </div>
        </div>
        ${this.renderActiveTab()}
        <div
          class="w-full ${this.randomMapDivider
            ? "pt-4 border-t border-[var(--hairline)]"
            : ""}"
        >
          ${this.renderSectionHeading(translateText("map_categories.special"))}
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <button
              type="button"
              class="pf-config-card w-full h-full p-3 flex flex-col items-center justify-between cursor-pointer transition-all duration-200 gap-3 group ${this
                .useRandomMap
                ? "is-active"
                : ""}"
              @click=${this.handleSelectRandomMap}
            >
              <div
                class="pf-map-preview-frame w-full aspect-[2/1] relative overflow-hidden rounded-[var(--radius-sm)]"
              >
                <img
                  src=${randomMap}
                  alt=${translateText("map.random")}
                  draggable="false"
                  loading="lazy"
                  decoding="async"
                  @dragstart=${this.preventImageDrag}
                  class="pf-map-preview-img w-full h-full object-contain"
                />
              </div>
              <div class="pf-card-label text-center">
                ${translateText("map.random")}
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
