<%*
let noteDate;
try {
  noteDate = tp.user.note_date(tp);
} catch {
  const title = String(tp.file.title ?? "").trim();
  noteDate = /^\d{4}-\d{2}-\d{2}$/.test(title) ? title : tp.date.now("YYYY-MM-DD");
}
tR += "";
%>
> [!tasks]+ ✅ Tasks `$= " (" + dv.pages("!#NoTaskCount").file.tasks.where( task => !task.completed && (task.text.includes("📅 <%* tR += noteDate %>") || task.text.includes("📅 <%* tR += moment(noteDate).subtract(1, 'days').format('YYYY-MM-DD') %>") )).length + ")"`
> ```tasks
> not done
> path regex does not match /Template/
> path regex does not match /Shopping/
> heading does not include shopping
> heading does not include prep
> heading does not include packing
> description regex does not match /Backburner|Packing/
> path regex does not match /Calisthenics/
> # group by filename
> (due before <%* tR += (moment(noteDate).add(1, 'days')).format('YYYY-MM-DD') %>) OR (no happens date)
> 
> group by function \
> 	   const duedate = task.due.moment ;\
> 	   const priority = task.priorityNumber; \
> 	   const label = (order, name) => `%%${order}%% ${name}`; \
> 	   if (!duedate) return label(4, '🌤️ Day'); \
> 		if (duedate.isBefore(moment("<%* tR += noteDate%>"), 'day')) return label (0,'❌ Overdue');\
> 	   if (priority == 0) return label(1, '🌄 Early Morning'); \
> 	   if (priority == 1) return label(2, '☀️ Morning'); \
> 	   if (priority == 2) return label(3, '🌞 Before Lunch'); \
> 	   if (priority == 3) return label(4, '🌤️ Day'); \
> 	   if (priority == 4) return label(5, '🌆 After Work'); \
> 	   if (priority == 5) return label(6, '🌃 Before Bed'); \
> 	   return label(6, 'Errors');
> no tags
> hide task count
> hide recurrence rule
> hide edit button
> hide priority
> hide due date
> short mode
> limit 100
> hide toolbar
> ```
