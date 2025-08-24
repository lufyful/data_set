'use strict';

require('dotenv').config();
const pLimit = require('p-limit').default;
const MangaChapter = require('../models/mangaChapter.cjs');
const Manga = require('../models/manga.cjs');
const { ManhuaFastScraper } = require('./extraScraper.cjs');

const PAGES = Number(process.env.PAGES || 2);
const CONCURRENCY = Number(process.env.CONCURRENCY || 10); // keep low for free tier

async function upsertManga(details) {
    const d = details.data;
    await Manga.findOneAndUpdate(
        { key: d.key },
        {
            $set: {
                key: d.key,
                title: d.title,
                cover: d.cover,
                description: d.description,
                genres: d.genres,
                totalChapters: d.totalChapters,
            },
        },
        { upsert: true, new: true }
    );
}

async function upsertChapterWithImages(mangaKey, chapter, scraper) {
    const chapterNumberNum = Number(chapter.number);
    // Skip if we already have images stored
    const existing = await MangaChapter.findOne({
        mangaKey,
        chapterNumber: chapterNumberNum,
        totalImages: { $gt: 0 },
        images: { $exists: true, $not: { $size: 0 } },
    }).lean();
    if (existing) return { skipped: true };

    const imagesResult = await scraper.getChapterImages(chapter.url);
    const query = { mangaKey, chapterNumber: chapterNumberNum };
    const update = {
        $set: {
            mangaKey,
            chapterNumber: chapterNumberNum,
            chapterUrl: chapter.url,
            lastTriedAt: new Date(),
        },
        $setOnInsert: {
            ...((!imagesResult.success || imagesResult.data.totalImages === 0) ? {
                totalImages: 0,
                images: [],
            } : {}),
        },
    };
    if (imagesResult.success && imagesResult.data.totalImages > 0) {
        update.$set.totalImages = imagesResult.data.totalImages;
        update.$set.images = imagesResult.data.images;
        update.$set.imagesFetchedAt = new Date();
    }


    const result = await MangaChapter.updateOne(query, update, { upsert: true });
    if (result.upsertedCount > 0 || result.modifiedCount > 0) {
        await Manga.updateOne(
            { key: mangaKey },
            { $set: { updatedAt: new Date() } }
        );
    }
    return {
        success: imagesResult.success,
        count: imagesResult.success ? imagesResult.data.totalImages : 0,
        source: imagesResult.source,
    };
}

async function scrapeAllMangaAllChapters() {
    const scraper = new ManhuaFastScraper();

    try {
        for (let page = PAGES; page >= 1; page--) {
            console.log(`\n=== Page ${page} ===`);
            const list = await scraper.getMangaList(page);
            for (let i = list.data.length - 1; i >= 0; i--) {
                const item = list.data[i];
                const details = await scraper.getMangaDetails(item.key, item.cover);
                if (!details.success) {
                    console.warn(`Failed to get details for ${item.key}`);
                    continue;
                }

                console.log(`Details via ${details.source} | chapters: ${details.data.totalChapters}`);
                await upsertManga(details);

                const limit = pLimit(CONCURRENCY);

                const jobs = details.data.chapters.map((ch) =>
                    limit(async () => {
                        try {
                            const res = await upsertChapterWithImages(details.data.key, ch, scraper);

                            if (res?.skipped) {
                            } else if (res?.success) {

                            } else {
                            }
                        } catch (e) {
                            console.error(`Chapter ${ch.number} error:`, e.message);
                        }
                    })
                );

                await Promise.all(jobs);
            }
        }
    } catch (err) {
        console.error('Scrape error:', err);
    } finally {
        await scraper.close();
        await require('mongoose').connection.close().catch(() => { });
        console.log('✅ Done');
        process.exit(0);
    }
}

module.exports = { scrapeAllMangaAllChapters };