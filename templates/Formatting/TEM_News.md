<%*
const dailyNews = app.metadataCache.getFirstLinkpathDest("News_Links","");
const Result_dailyNews = (await app.vault.read(dailyNews)).split("\n");
na = Math.floor(Math.random()*Result_dailyNews.length);


tR += "- [ ] 📔 " + Result_dailyNews[na] + "something [[Z_Personal admin/Gaz Fun/📗 Reading/Reading Log.md|interesting]]" %> 🔺