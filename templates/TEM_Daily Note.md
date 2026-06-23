---
cssclasses:
  - clean-embeds
  - hide-title
  - hide-embedded-header

tags:
  - dailynote
fastedmeals: 0
date: <% tp.file.title %>



---
<%*
// Note date from filename (YYYY-MM-DD) when present, else today
let noteDate;
try {
  noteDate = tp.user.note_date(tp);
} catch {
  const title = String(tp.file.title ?? "").trim();
  noteDate = /^\d{4}-\d{2}-\d{2}$/.test(title) ? title : tp.date.now("YYYY-MM-DD");
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Get current note file reliably (handles “new note still being created” timing)
const path = tp.file.path(true);
let file = app.vault.getAbstractFileByPath(path);

for (let i = 0; i < 10 && !file; i++) {
  await sleep(100);
  file = app.vault.getAbstractFileByPath(path);
}

if (file) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.date = noteDate;
  });
}

tR += "";
%>


> [!header]+ <%* tR += moment(noteDate, "YYYY-MM-DD").format('dddd Do MMMM YYYY') %> [[Diaries/Weekly/<%* tR += (moment(noteDate).add(0, 'days')).format('YYYY') %>-W<%* tR += (moment(noteDate).add(0, 'days')).format('WW') %>|Week <%* tR += (moment(noteDate).add(0, 'days')).format('W') %>]]
> <% tp.file.include("[[Templates/TEM_Milestone.md]]") %>

```dataviewjs
const links = [
  { path: "Z_Personal admin/Prep/Door Prep/Door Prep List", label: "Door Prep",     emoji: "🚪" },
  { path: "Z_Personal admin/Exercise/Gym Kit/Gym Kit Prep", label: "Gym Kit Prep", emoji: "🏋️" },
  { path: "Z_Personal admin/Prep/Work Prep/Work Prep List", label: "Work Prep",     emoji: "💼" },
];

const row = dv.el("div", "", { cls: "prep-button-row" });

for (const l of links) {
  const a = document.createElement("a");
  a.classList.add("internal-link", "prep-button");
  a.setAttribute("data-href", l.path);
  a.setAttribute("href", l.path); // Obsidian intercepts internal links
  a.textContent = l.emoji;
  row.appendChild(a);
}

const shopBtn = document.createElement("button");
shopBtn.type = "button";
shopBtn.classList.add("prep-button");
shopBtn.dataset.action = "shopping-quick-add";
shopBtn.textContent = "🛒";
row.appendChild(shopBtn);

```
<%* tR += await tp.user.bake_dashboard_row(tp) %>

<% tp.file.include("[[Templates/Formatting/TEM_Tasks_Header]]") %>

> [!shopping]+ 🛒 [[Shopping List|Shopping]] // 📝 Prep
> ![[Templates/Formatting/TEM_Shopping_Callout_State]]
> ```tasks
> not done
> path does not include Template
> (heading includes Shopping) OR (heading includes Packing) OR (heading includes Prep)
> (heading does not include <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY') %>) OR (heading includes <%* tR += noteDate %>)
> (happens today) OR (no happens date)
> tags does not include #backburner
> group by heading
> short mode
> limit 30
> hide toolbar
> # hide lightning button
> ```

![[<%*
tR += moment(noteDate).add(0, 'days').format('YYYY') %>-W<%* tR += moment(noteDate).add(0, 'days').format('WW') %>#<%* tR += moment(noteDate).add(0, 'days').format('dddd D MMMM') %>]]
<%* tR += await tp.user.bake_gcal(tp) %>

<% tp.file.include("[[TEM_ProjectsDV]]") %>

<%* tR += await tp.user.bake_gb_online_daily(tp) %>

<% tp.file.include("[[Templates/Formatting/TEM_Today_Iam]]") %>

> [!tomorrow]- 🗓️ [[--- TODO ---#Scheduled|Tomorrow]]
> ```tasks
> not done
> description regex does not match /Backburner/
> path regex does not match /Calisthenics/path regex does not match /Calisthenics/
> sort by start date
> has due date
> happens <%* tR += (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>
> short mode
> hide recurrence rule
> hide priority
> hide due date
> limit 100
> hide toolbar
> hide task count
> ```

> [!daily]- 📋 Daily Tasks
> #### [[Completed Today|✅ Completed Today]] (`$=dv.pages().file.tasks.where( task => task.completed &&  task.text.includes("✅ <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>")).length`)
> - [ ] 📰 Check the [Headlines](https://www.bbc.co.uk/news/topics/cpml2v678pxt) 🔺  📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> - [ ] 🟪 Do [NYT Connections](https://www.nytimes.com/games/connections) 🔺  📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> <% tp.file.include("[[Templates/Formatting/TEM_News]]") %> 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> <% tp.file.include("[[Templates/Formatting/TEM_Puzzles]]") %> 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> - [ ] 🦉 [Duolingo](shortcuts://run-shortcut?name=Duolingo) day <%* tR += (moment(noteDate).add(0, 'days')).format('DDD') - (-1006) %> 🔺  📅  <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> <%* if (moment(noteDate).add(0, 'days').format('dddd') == "Saturday"){%>
> - [ ] 📱 Authenticate Google Calendar Phone ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> - [ ] 💻 Authenticate Google Calendar iPad ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> - [ ] 🖥️ Authenticate Google Calendar PC ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> <%*}%>
> <% tp.file.include("[[Templates/TEM_BJJ_Tutorial]]") %> 🔺 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %> 
> 
><%* if (moment(noteDate).add(0, 'days').format('DD') == "01") {%>
>
>### Monthly Tasks
>
>- [ ] 💷 Sort [Natwest Money](https://docs.google.com/spreadsheets/d/1PbpTraswzvSl1ay-ArqvdUiseeIETg9u_74g235HgTE/edit?usp=sharing) 🔼 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
> - [ ] 📈 Check Investments 🔼 📅 <%* tR += (moment(noteDate).add(7, 'days')).format('YYYY-MM-DD') }%>

> [!refresh]+ 🔄️ Refresh
