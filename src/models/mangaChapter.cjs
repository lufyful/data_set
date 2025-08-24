let {mongoose} = require("./mongo.cjs");

const ChapterSchema = new mongoose.Schema({
  mangaKey: { type: String, required: true, index: true },
  chapterNumber: { type: Number, required: true },
  chapterUrl: { type: String, default: '' },
  totalImages: { type: Number, default: 0 },
  images: { type: [String], default: [] },
  imagesFetchedAt: { type: Date },
  lastTriedAt: { type: Date },
  totalViews: { type: Number, default: 0 }
}, {
  timestamps: true
});
ChapterSchema.index({ mangaKey: 1, chapterNumber: 1 }, { unique: true });
module.exports = mongoose.model('Chapter', ChapterSchema);
