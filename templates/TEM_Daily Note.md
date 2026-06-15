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
// SET DATE FIELD IN FRONTMATTER
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Get current note file reliably (handles “new note still being created” timing)
const path = tp.file.path(true);
let file = app.vault.getAbstractFileByPath(path);

for (let i = 0; i < 10 && !file; i++) {
  await sleep(100);
  file = app.vault.getAbstractFileByPath(path);
}

if (!file) {
  tR += "";
  return;
}

// Prefer filename if it already looks like YYYY-MM-DD, otherwise use today
const filename = (tp.file.title ?? "").trim();
const ymdFromName = /^\d{4}-\d{2}-\d{2}$/.test(filename) ? filename : null;

// Templater date formatted as YYYY-MM-DD
const todayYmd = tp.date.now("YYYY-MM-DD");
const ymd = ymdFromName ?? todayYmd;

await app.fileManager.processFrontMatter(file, (fm) => {
  fm.date = ymd; // creates if absent, overwrites if present
});

tR += "";
%>


<%* const noteDate = await tp.file.title %>
## <%* tR += (moment(noteDate).add(0, 'days')).format('dddd Do MMM YYYY') %>
<hr style="margin-bottom:-8px;margin-top:-8px"></hr>

[[Diaries/Weekly/<%* tR += (moment(noteDate).add(0, 'days')).format('YYYY') %>-W<%* tR += (moment(noteDate).add(0, 'days')).format('WW') %>|Week <%* tR += (moment(noteDate).add(0, 'days')).format('W') %>]] // <% tp.file.include("[[Templates/TEM_Milestone.md]]") %>
<hr style="margin-bottom:-8px;margin-top:-8px"></hr>

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
  a.textContent = `  ${l.emoji}  `;
  row.appendChild(a);
}

```
<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Weather]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Hevy]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Weight]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Bake_Habits]]") %>

<% tp.file.include("[[Templates/Formatting/TEM_Dashboard_Handlers]]") %>

***

  

#### [[Quick Tasks|✅ Tasks]] (`$=dv.pages("!#NoTaskCount").file.tasks.where( task => !task.completed && (task.text.includes("📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>") || task.text.includes("📅 <%* tR += (moment(noteDate).add(-1, 'days')).format('YYYY-MM-DD') %>") )).length`)  

  

<hr style ="margin-top:-12px; margin-bottom:-12px">  

  

```tasks  
not done  
path regex does not match /Template/  
path regex does not match /Shopping/  
heading does not include shopping  
heading does not include prep  
heading does not include packing  
description regex does not match /Backburner|Packing/  
path regex does not match /Calisthenics/  
# group by filename  
(due before <%* tR += (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>) OR (no happens date)  

group by function \
	   const duedate = task.due.moment ;\
	   const priority = task.priorityNumber; \
	   const label = (order, name) => `%%${order}%% ${name}`; \
	   if (!duedate) return label(4, '🌤️ Day'); \
		if (duedate.isBefore(moment("<%* tR += noteDate%>"), 'day')) return label (0,'❌ Overdue');\
	   if (priority == 0) return label(1, '🌄 Early Morning'); \
	   if (priority == 1) return label(2, '☀️ Morning'); \
	   if (priority == 2) return label(3, '🌞 Before Lunch'); \
	   if (priority == 3) return label(4, '🌤️ Day'); \
	   if (priority == 4) return label(5, '🌆 After Work'); \
	   if (priority == 5) return label(6, '🌃 Before Bed'); \
	   return label(6, 'Errors');
no tags
hide task count
hide recurrence rule
hide edit button
hide priority
hide due date
short mode
limit 100
hide toolbar
```  

  

  

<hr style ="margin-top:12px; margin-bottom:-12px">

### [[Shopping List|🛒 Shopping]] // 📝 Prep

<hr style ="margin-top:-6px; margin-bottom:-12px">

```tasks
not done
path does not include Template
(heading includes Shopping) OR (heading includes Packing) OR (heading includes Prep)
(heading does not include <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY') %>) OR (heading includes <%* tR += noteDate %>)
(happens today) OR (no happens date)
tags does not include #backburner
group by heading
short mode
limit 30
hide toolbar
```

<hr style ="margin-top:12px; margin-bottom:-12px">

##### [[ <%* tR += (moment(noteDate).add(-1, 'days')).format('YYYY-MM-DD') %>|⬅️ Previous]] // [[<%* tR += "Diaries/" + (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>|Next ➡️]] // [[Ten Day Planner|Ten Day]] 🗓️
![[<%*
tR += moment(noteDate).add(0, 'days').format('YYYY') %>-W<%* tR += moment(noteDate).add(0, 'days').format('WW') %>#<%* tR += moment(noteDate).add(0, 'days').format('dddd D MMMM') %>]]
```gEvent 
type: schedule
date: <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
exclude: ["Games Releases"]
timespan: 1
```

<hr style ="margin-top:8px; margin-bottom:-12px">

### [[--- TODO ---/Projects|Projects]]

<hr style ="margin-top:-6px; margin-bottom:-12px">

<% tp.file.include("[[TEM_ProjectsDV]]") %>

### 🗓️ [[--- TODO ---#Scheduled|Tomorrow]]
<hr style ="margin-top:-6px; margin-bottom:-12px">

```tasks
not done
description regex does not match /Backburner/
path regex does not match /Calisthenics/path regex does not match /Calisthenics/
sort by start date
has due date
happens <%* tR += (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>
short mode
hide recurrence rule
hide priority
hide due date
limit 100
hide toolbar
```
<hr style ="margin-top:8px; margin-bottom:-8px">


#### [[Completed Today|✅ Completed Today]] (`$=dv.pages().file.tasks.where( task => task.completed &&  task.text.includes("✅ <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>")).length`)

<hr style ="margin-top:-8px; margin-bottom:-12px">

### Daily Tasks
<hr style ="margin-top:-8px; margin-bottom:12px">




- [ ] 📰 Check the [Headlines](https://www.bbc.co.uk/news/topics/cpml2v678pxt) 🔺  📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 🟪 Do [NYT Connections](https://www.nytimes.com/games/connections) 🔺  📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<% tp.file.include("[[Templates/Formatting/TEM_News]]") %> 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<% tp.file.include("[[Templates/Formatting/TEM_Puzzles]]") %> 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 🦉 [Duolingo](shortcuts://run-shortcut?name=Duolingo) day <%* tR += (moment(noteDate).add(0, 'days')).format('DDD') - (-1006) %> 🔺  📅  <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<%* if (moment(noteDate).add(0, 'days').format('dddd') == "Saturday"){%>
- [ ] 📱 Authenticate Google Calendar Phone ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 💻 Authenticate Google Calendar iPad ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 🖥️ Authenticate Google Calendar PC ⏫ 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
<%*}%>
<% tp.file.include("[[Templates/TEM_BJJ_Tutorial]]") %>
<%* if (moment(noteDate).add(0, 'days').format('DD') == "01") {%>
<hr style ="margin-top:-8px; margin-bottom:12px">

### Monthly Tasks
<hr style ="margin-top:-8px; margin-bottom:12px">

- [ ] 💷 Sort [Natwest Money](https://docs.google.com/spreadsheets/d/1PbpTraswzvSl1ay-ArqvdUiseeIETg9u_74g235HgTE/edit?usp=sharing) 🔼 📅 <%* tR += (moment(noteDate).add(0, 'days')).format('YYYY-MM-DD') %>
- [ ] 📈 Check Investments 🔼 📅 <%* tR += (moment(noteDate).add(7, 'days')).format('YYYY-MM-DD') }%>

***
***

> [!note] *[<%*
const NPC_NameStart_1 = app.metadataCache.getFirstLinkpathDest("Today I am","");
const Result_NPC_NameStart_1 = (await app.vault.read(NPC_NameStart_1)).split("\n");
na = Math.floor(Math.random()*Result_NPC_NameStart_1.length);

const NPC_NameMid_1 = app.metadataCache.getFirstLinkpathDest("Today I am","");
const Result_NPC_NameMid_1 = (await app.vault.read(NPC_NameMid_1)).split("\n");
nb = Math.floor(Math.random()*Result_NPC_NameMid_1.length);

const NPC_NameEnd_1 = app.metadataCache.getFirstLinkpathDest("Today I am","");
const Result_NPC_NameEnd_1 = (await app.vault.read(NPC_NameEnd_1)).split("\n");
nc = Math.floor(Math.random()*Result_NPC_NameEnd_1.length);

tR += "Today I am " + Result_NPC_NameStart_1[na] + ", " + Result_NPC_NameMid_1[nb] + " and " + Result_NPC_NameEnd_1[nc] + "."  %>](obsidian://open?vault=%F0%9F%94%90%20Diaries&file=Diaries)*

***
