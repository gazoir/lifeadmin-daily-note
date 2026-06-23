```dataviewjs
const root = dv.el("div", "", { cls: "dashboard-tasks-header dashboard-shopping-prep-header" });
const link = root.createEl("a", {
  cls: "internal-link dashboard-tasks-header-title",
  text: "🛒 Shopping",
  href: "Shopping List",
});
link.dataset.href = "Shopping List";
root.createEl("span", { cls: "dashboard-tasks-header-subtitle", text: " // 📝 Prep" });

function markNextTasksEmbed() {
  const originBlock =
    root.closest(".cm-preview-code-block") ??
    root.closest(".block-language-dataviewjs");
  if (!originBlock) return false;

  let sib = originBlock.nextElementSibling;
  while (sib) {
    const tasksBlock = sib.classList?.contains("block-language-tasks")
      ? sib
      : sib.querySelector?.(".block-language-tasks");
    if (tasksBlock) {
      const wrap = sib.classList?.contains("cm-preview-code-block")
        ? sib
        : sib.closest?.(".cm-preview-code-block");
      if (wrap instanceof HTMLElement) {
        wrap.classList.add("dashboard-tasks-embed", "dashboard-shopping-embed", "dashboard-shopping-embed-wrap");
      }
      tasksBlock.classList.add("dashboard-tasks-embed", "dashboard-shopping-embed");
      return true;
    }
    if (sib.querySelector?.(".block-language-dataviewjs")) break;
    sib = sib.nextElementSibling;
  }
  return false;
}

if (!markNextTasksEmbed()) {
  for (const ms of [50, 150, 400, 800, 1500]) {
    window.setTimeout(markNextTasksEmbed, ms);
  }
}
```
