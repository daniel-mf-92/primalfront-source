import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  createRenderRoot() {
    return this;
  }

  render() {
    const isVisible = this.isVisible;
    return html`
      <div
        class="pf-starting-backdrop fixed inset-0 z-[9998] transition-all duration-300 ${isVisible
          ? "opacity-100 visible"
          : "opacity-0 invisible"}"
      ></div>
      <div
        class="pf-starting-panel fixed top-1/2 left-1/2 z-[9999] w-[400px] max-w-[calc(100vw-2rem)] text-center -translate-x-1/2 ${isVisible
          ? "opacity-100 visible -translate-y-1/2"
          : "opacity-0 invisible -translate-y-[46%]"}"
      >
        <div class="pf-starting-eyebrow">© Primalfront · © OpenFront and Contributors</div>

        <div class="pf-starting-divider"></div>

        <div class="pf-starting-title-row">
          <span class="pf-starting-dots" aria-hidden="true">
            <span></span><span></span><span></span>
          </span>
          <span class="pf-starting-title"
            >${translateText("game_starting_modal.title")}</span
          >
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
