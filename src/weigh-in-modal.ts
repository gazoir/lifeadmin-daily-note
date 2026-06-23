import { App, Modal, Notice, setIcon } from "obsidian";

export class WeighInModal extends Modal {
  private weightVal = "";
  private bfVal = "";

  constructor(
    app: App,
    private readonly dateLabel: string,
    initialWeight: string,
    initialBf: string,
    private readonly onSave: (weight: number, bf: number) => Promise<void>,
    private readonly onBluetooth: () => void,
  ) {
    super(app);
    this.weightVal = initialWeight;
    this.bfVal = initialBf;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("lifeadmin-weigh-in-modal");
    modalEl.addClass("lifeadmin-weigh-in-modal-container");
    this.titleEl.setText(`Weigh in ${this.dateLabel}`);

    const fields = contentEl.createDiv({ cls: "lifeadmin-weigh-in-fields" });

    const weightInput = this.addUnitField(fields, "Weight", "kg", this.weightVal, (v) => {
      this.weightVal = v;
    });
    const bfInput = this.addUnitField(fields, "Body fat", "%", this.bfVal, (v) => {
      this.bfVal = v;
    });

    setTimeout(() => weightInput.focus(), 0);

    const actions = contentEl.createDiv({ cls: "lifeadmin-weigh-in-actions" });

    actions
      .createEl("button", { text: "Save", cls: "mod-cta" })
      .addEventListener("click", () => {
        void this.submitSave();
      });

    const bluetoothBtn = actions.createEl("button", {
      cls: "lifeadmin-weigh-in-bluetooth",
      attr: { "aria-label": "Bluetooth weigh-in", title: "Bluetooth weigh-in" },
    });
    setIcon(bluetoothBtn, "bluetooth");
    bluetoothBtn.addEventListener("click", () => {
      this.close();
      this.onBluetooth();
    });

    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      this.close();
    });

    const submitOnEnter = (event: KeyboardEvent): void => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.submitSave();
    };
    weightInput.addEventListener("keydown", submitOnEnter);
    bfInput.addEventListener("keydown", submitOnEnter);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addUnitField(
    parent: HTMLElement,
    label: string,
    unit: string,
    initial: string,
    onInput: (value: string) => void,
  ): HTMLInputElement {
    const row = parent.createDiv({ cls: "lifeadmin-weigh-in-field" });
    row.createEl("label", { text: label, cls: "lifeadmin-weigh-in-label" });
    const wrap = row.createDiv({ cls: "lifeadmin-weigh-in-input-wrap" });
    const input = wrap.createEl("input", {
      type: "number",
      cls: "lifeadmin-weigh-in-input mod-input",
      attr: { step: "0.1", inputmode: "decimal" },
    });
    input.value = initial;
    wrap.createSpan({ cls: "lifeadmin-weigh-in-unit", text: unit });
    input.addEventListener("input", () => {
      onInput(input.value);
    });
    return input;
  }

  private async submitSave(): Promise<void> {
    const weight = Number.parseFloat(this.weightVal.replace(",", "."));
    const bf = Number.parseFloat(this.bfVal.replace(",", "."));
    if (!Number.isFinite(weight) || weight <= 0) {
      new Notice("Enter a valid weight in kg.");
      return;
    }
    if (!Number.isFinite(bf) || bf <= 0 || bf > 100) {
      new Notice("Enter a valid body fat %.");
      return;
    }
    await this.onSave(weight, bf);
    this.close();
  }
}
