module.exports = (tp) => {
  const title = String(tp.file.title ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(title) ? title : tp.date.now("YYYY-MM-DD");
};
