let {mongoose} = require("./mongo.cjs");

const MangaSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  cover: { type: String, required: true },
  description: { type: String },
  genres: [{ type: String }],
  totalChapters: { type: Number, default: 0 },
  totalViews: { type: Number, default: 0 }
}, {
  timestamps: true
});
MangaSchema.index({ key: 1 }, { unique: true });
module.exports = mongoose.model('Manga', MangaSchema);