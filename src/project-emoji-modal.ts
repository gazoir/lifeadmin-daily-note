import { App, Modal, Setting } from "obsidian";
import { firstEmojiChar, splitLeadingEmoji } from "./emoji-utils";

const PROJECT_EMOJI_CHOICES = [
  "🎂", "🎉", "🎈", "🎁", "💍", "👶", "🎓", "🎭", "🎵", "🎬",
  "✈️", "🏖️", "🏠", "🚗", "🚌", "🛒", "🍽️", "☕", "🍷", "🎄",
  "💼", "📋", "📅", "💡", "🔧", "🔬", "💰", "🏦", "📚", "✏️",
  "💪", "🏋️", "⚽", "🎾", "🎮", "🏥", "❤️", "🌟", "⭐", "✅",
  "🌱", "🌸", "🍂", "❄️", "☀️", "🌙", "🔥", "🐕", "📸", "🧳",
];

export function promptProjectEmoji(app: App, eventLabel: string): Promise<string | null> {
  const { emoji: titleEmoji, rest: labelWithoutEmoji } = splitLeadingEmoji(eventLabel);
  const defaultEmoji = titleEmoji || "📋";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const modal = new ProjectEmojiModal(app, labelWithoutEmoji || eventLabel, defaultEmoji, (emoji) => finish(emoji));
    const baseOnClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      baseOnClose();
      finish(null);
    };
    window.setTimeout(() => modal.open(), 0);
  });
}

class ProjectEmojiModal extends Modal {
  private selected: string;

  constructor(
    app: App,
    private readonly eventLabel: string,
    defaultEmoji: string,
    private readonly onChoose: (emoji: string) => void,
  ) {
    super(app);
    this.selected = defaultEmoji;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Pick project emoji");

    contentEl.createEl("p", {
      text: this.eventLabel,
      cls: "lifeadmin-project-emoji-event-label",
    });

    const preview = contentEl.createDiv({ cls: "lifeadmin-project-emoji-preview" });
    preview.style.cssText =
      "font-size:42px;line-height:1;text-align:center;margin:8px 0 12px;padding:12px;border-radius:10px;background:var(--background-secondary);";

    const updatePreview = (emoji: string): void => {
      this.selected = emoji;
      preview.setText(`${emoji} ${this.eventLabel}`);
    };
    updatePreview(this.selected);

    const input = contentEl.createEl("input", { type: "text", cls: "lifeadmin-project-emoji-input" });
    input.value = this.selected;
    input.placeholder = "Type or paste an emoji";
    input.style.cssText =
      "display:block;width:100%;font-size:28px;text-align:center;padding:8px;margin-bottom:12px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);touch-action:manipulation;";
    input.addEventListener("input", () => {
      const em = firstEmojiChar(input.value);
      if (em) updatePreview(em);
    });

    const grid = contentEl.createDiv({ cls: "lifeadmin-project-emoji-grid" });
    grid.style.cssText =
      "display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:6px;margin-bottom:14px;max-height:220px;overflow-y:auto;";

    for (const emoji of PROJECT_EMOJI_CHOICES) {
      const btn = grid.createEl("button", { text: emoji, cls: "lifeadmin-project-emoji-btn" });
      btn.type = "button";
      btn.style.cssText =
        "font-size:22px;line-height:1;width:100%;aspect-ratio:1;padding:0;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);cursor:pointer;touch-action:manipulation;";
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        input.value = emoji;
        updatePreview(emoji);
      });
    }

    const actions = new Setting(contentEl);
    actions.addButton((btn) =>
      btn
        .setButtonText("Create project")
        .setCta()
        .onClick(() => {
          const emoji = firstEmojiChar(input.value) || this.selected;
          this.onChoose(emoji);
          this.close();
        }),
    );
    actions.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));

    window.setTimeout(() => input.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
