import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-number")
export class SettingNumber extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const newValue = Number(input.value);
    this.value = newValue;

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: newValue },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const rainbowClass = this.easter
      ? "bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)] bg-[length:1400%_1400%] animate-rainbow-bg text-text hover:bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)]"
      : "";

    return html`
      <div
        class="flex flex-row items-center justify-between w-full p-4 bg-surface-0/5 border border-hairline rounded-xl hover:bg-surface-2/60 transition-all gap-4 ${rainbowClass}"
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <label
            class="text-text font-bold text-base block mb-1"
            for="setting-number-input"
            >${this.label}</label
          >
          <div class="text-text-dim text-sm leading-snug">
            ${this.description}
          </div>
        </div>
        <input
          type="number"
          id="setting-number-input"
          class="shrink-0 w-[100px] py-2 px-3 border border-hairline-strong rounded-lg bg-surface-3 text-text font-mono text-center focus:outline-none focus:border-teal focus:ring-1 focus:ring-teal transition-all"
          .value=${String(this.value ?? 0)}
          min=${this.min}
          max=${this.max}
          @input=${this.handleInput}
        />
      </div>
    `;
  }
}
