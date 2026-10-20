import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-toggle")
export class SettingToggle extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.checked = input.checked;
  }

  render() {
    const rainbowClass = this.easter
      ? "bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)] bg-[length:1400%_1400%] animate-rainbow-bg text-text hover:bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)]"
      : "";

    return html`
      <label
        class="flex flex-row items-center justify-between w-full p-4 bg-surface-0/5 border border-hairline rounded-xl hover:bg-surface-2/60 transition-all gap-4 cursor-pointer ${rainbowClass}"
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <div class="text-text font-bold text-base block mb-1">
            ${this.label}
          </div>
          <div class="text-text-dim text-sm leading-snug">
            ${this.description}
          </div>
        </div>

        <div class="relative inline-block w-[52px] h-[28px] shrink-0">
          <input
            type="checkbox"
            class="opacity-0 w-0 h-0 peer"
            id=${this.id}
            ?checked=${this.checked}
            @change=${this.handleChange}
          />
          <span
            class="absolute inset-0 bg-surface-0/30 border border-gold-deep transition-all duration-300 rounded-full
            before:absolute before:content-[''] before:h-5 before:w-5 before:left-[3px] before:top-[3px]
            before:bg-surface-0/50 before:transition-all before:duration-300 before:rounded-full before:shadow-sm hover:before:bg-surface-0/70
            peer-checked:bg-teal peer-checked:border-teal-deep peer-checked:before:translate-x-[24px] peer-checked:before:bg-gold-bright"
          ></span>
        </div>
      </label>
    `;
  }
}
