import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "xs" | "sm" | "md" | "lg";
type ButtonWidth = "auto" | "block" | "blockDesktop" | "fill";
type IconPosition = "left" | "right" | "only";

@customElement("o-button")
export class OButton extends LitElement {
  @property() title = "";
  @property() translationKey = "";
  @property() variant: ButtonVariant = "primary";
  @property() size: ButtonSize = "md";
  @property() width: ButtonWidth = "auto";
  @property() iconPosition: IconPosition = "left";
  @property({ attribute: false }) icon?: TemplateResult;
  @property({ type: Boolean }) disable = false;
  @property({ type: Boolean }) submit = false;

  createRenderRoot() {
    return this;
  }

  private readonly BASE =
    "font-display font-bold uppercase tracking-wider rounded-[var(--radius)] border " +
    "transition-all duration-[120ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] transform hover:-translate-y-px active:translate-y-0 active:scale-[0.97] " +
    "outline-none text-center whitespace-normal break-words leading-tight overflow-hidden relative " +
    "disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:active:scale-100 disabled:opacity-50";

  private variantClasses(): string {
    switch (this.variant) {
      // Primary CTA — solid age-accent fill, accent ring + glow.
      case "primary":
        return (
          "bg-[var(--age-accent)] hover:bg-[var(--age-accent-hi)] text-[var(--surface-0)] border-transparent " +
          "shadow-[var(--ring-accent)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-lo)] disabled:shadow-none"
        );
      // Secondary — RECEDES: transparent fill, hairline border, dimmed text, so
      // only the primary (age-accent) CTA reads as the action. Hover lifts the
      // text + border one notch with a faint surface wash (no accent).
      case "secondary":
        return (
          "bg-transparent hover:bg-[color-mix(in_srgb,var(--surface-2)_50%,transparent)] " +
          "text-[var(--text-dim)] hover:text-[var(--text)] " +
          "border-[var(--hairline)] hover:border-[var(--hairline-strong)] " +
          "disabled:bg-transparent disabled:text-[var(--text-lo)]"
        );
      // Danger / attack — ember counter-accent.
      case "danger":
        return (
          "bg-[var(--ember)] hover:brightness-110 text-[var(--surface-0)] border-transparent " +
          "disabled:bg-[var(--surface-2)] disabled:text-[var(--text-lo)]"
        );
      // Ghost — transparent, accent text, soft surface wash on hover.
      case "ghost":
        return (
          "bg-transparent hover:bg-[var(--surface-2)] text-[var(--age-accent)] border-transparent hover:border-[var(--hairline)] " +
          "disabled:text-[var(--text-lo)] disabled:hover:bg-transparent disabled:hover:border-transparent"
        );
    }
  }

  private sizeClasses(): string {
    if (this.iconPosition === "only") {
      switch (this.size) {
        case "xs":
          return "w-6 h-6 text-xs";
        case "sm":
          return "w-8 h-8 text-sm";
        case "md":
          return "w-10 h-10 text-base";
        case "lg":
          return "w-12 h-12 text-lg";
      }
    }
    switch (this.size) {
      case "xs":
        return "py-1 px-2 text-xs";
      case "sm":
        return "py-1.5 px-3 text-sm";
      case "md":
        return "py-3 px-4 text-base lg:text-lg";
      case "lg":
        return "py-4 px-6 text-lg lg:text-xl";
    }
  }

  private widthClasses(): string {
    switch (this.width) {
      case "auto":
        return "inline-flex items-center justify-center gap-2";
      case "block":
        return "flex w-full items-center justify-center gap-2";
      case "blockDesktop":
        return "flex w-full items-center justify-center gap-2 lg:w-1/2 lg:mx-auto";
      case "fill":
        return "flex w-full h-full items-center justify-center gap-2";
    }
  }

  render() {
    const label =
      this.translationKey === ""
        ? this.title
        : translateText(this.translationKey);
    const iconOnly = this.iconPosition === "only";
    const classes = `${this.BASE} ${this.variantClasses()} ${this.sizeClasses()} ${this.widthClasses()}`;

    return html`
      <button
        class=${classes}
        ?disabled=${this.disable}
        type=${this.submit ? "submit" : "button"}
        aria-label=${iconOnly ? label : nothing}
      >
        ${this.icon && this.iconPosition !== "right" ? this.icon : nothing}
        ${iconOnly ? nothing : html`<span class="min-w-0">${label}</span>`}
        ${this.icon && this.iconPosition === "right" ? this.icon : nothing}
      </button>
    `;
  }
}
