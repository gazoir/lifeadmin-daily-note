<%*
const dailyPuzzle = app.metadataCache.getFirstLinkpathDest("Puzzle_Links","");
const Result_dailyPuzzle = (await app.vault.read(dailyPuzzle)).split("\n");
na = Math.floor(Math.random()*Result_dailyPuzzle.length);


tR += "- [ ] " + Result_dailyPuzzle[na]  %> 🔺