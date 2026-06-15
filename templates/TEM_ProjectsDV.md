<hr style ="margin-top:8px; margin-bottom:-12px">

<%*  
const projectsdv = app.plugins.plugins["dataview"].api;
const projectste = await projectsdv.queryMarkdown('LIST "<br>" + choice(((date(today) - date).days > -7), "❗ ", "⏳ ")  + "<small>" + choice(((date(today) - date).days > 1),  floor(((date(today) - date).days))  + " days ago", "") + choice(((date(today) - date).days = 1), "Yesterday", "") + choice(((date(today) - date).days = 0), "Today", "") + choice(((date(today) - date).days = -1), "Tomorrow", "") + choice(((date(today) - date).days < -1), "in " + floor(((date(today) - date).days)) * -1 + " days", "") + "</small>" FROM #project AND -#complete AND -"#ongoing" AND -"Templates" AND -"Diaries" AND -"Archive" Sort date LIMIT 3');
tR += projectste.value;
%>
<%*  
const ongoingdv = app.plugins.plugins["dataview"].api;
const ongoingste = await projectsdv.queryMarkdown('LIST "<br>"+ choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days > 6, "❗", "📝 ") + "<small>" + choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days = 0, "Today", "")  + choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days = 1, "Yesterday", "")  + choice((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days > 1, ((date(today) - date(dateformat(file.mtime,"yyyy-MM-dd"))).days)+ " days ago","") + "</small>" from #ongoing AND -"Templates" SORT file.mtime desc');
tR += ongoingste.value;
%>


