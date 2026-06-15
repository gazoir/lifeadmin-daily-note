<%* const MilestoneFile = app.metadataCache.getFirstLinkpathDest("Milestone_Info","");
const MilestoneEvent = (await app.vault.read(MilestoneFile)).split("\n");
tR += "[[" + MilestoneEvent[0] + "\|" + MilestoneEvent[1] + "]] in "

const Difference_in_Time = moment(MilestoneEvent[2]) - moment();
const daysTilMilestone = (Difference_in_Time / (1000 * 3600 * 24)) + 1;

tR += "[[Milestone_Info|" +  Math.floor(daysTilMilestone) + "]] days"

%>