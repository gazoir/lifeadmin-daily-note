```dataviewjs
const file = app.vault.getAbstractFileByPath("Z_Personal admin/Domestic God/Shopping List.md")
  ?? app.metadataCache.getFirstLinkpathDest("Shopping List", "");

async function shoppingListHasIncompleteTasks() {
  if (!file) return false;
  const text = String(await dv.io.load(file.path) ?? "");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let inSection = false;
  for (const line of lines) {
    if (/^# 🛒 Shopping List\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^# /.test(line)) break;
    if (inSection && /^\s*-\s*\[\s*\]/.test(line)) return true;
  }
  return false;
}

async function syncShoppingCallout() {
  const callout =
    dv.container?.closest?.(".callout[data-callout='shopping']")
    ?? document.querySelector(".callout[data-callout='shopping']");
  if (!callout) return false;

  const hasItems = await shoppingListHasIncompleteTasks();
  callout.classList.add("dashboard-shopping-callout-ready");
  callout.classList.toggle("dashboard-shopping-callout-hidden", !hasItems);
  callout.classList.remove("is-collapsed");

  const block =
    dv.container?.closest?.(".block-language-dataviewjs, .cm-preview-code-block");
  block?.classList.add("dashboard-shopping-callout-state-source");
  return true;
}

if (!(await syncShoppingCallout())) {
  for (const ms of [50, 150, 400, 800, 1500]) {
    window.setTimeout(() => void syncShoppingCallout(), ms);
  }
}
```
