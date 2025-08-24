'use strict';
const pLimit = require('p-limit').default;
require('dotenv').config();
const MangaChapter = require('../models/mangaChapter.cjs');
const Manga = require('../models/manga.cjs');
const { DemonicScansScraper, FastDemonicScansScraper } = require('./demonicScansScraper');
const CONCURRENCY = Number(process.env.CONCURRENCY || 1);
const PAGES = Number(process.env.PAGES || 2);

function slugify(title) {
    return title
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

async function upsertManga(details) {
    try {
        const d = details;

        // Ensure cover URL is encoded (spaces -> %20)
        const safeCover = d.cover;
        console.log(safeCover)
        await Manga.findOneAndUpdate(
            { key: d.key },
            {
                $set: {
                    key: slugify(d.title),
                    title: d.title,
                    cover: safeCover,
                    description: d.description,
                    genres: d.genres,
                    totalChapters: d.totalChapters,
                    totalViews: 0
                },
            },
            { upsert: true, new: true }
        );
    }
    catch (er) {
        // console.log(er)
    }
}

async function newScrap() {
    const scraper = new FastDemonicScansScraper();

    try {
        for (let page = PAGES; page >= 1; page--) {
            console.log(`\n=== DemonicScans Page ${page} ===`);
            const list = await scraper.getMangaList(page);
            if (!list?.length) {
                console.warn(`Failed to get manga list page ${page}:`, list?.error);
                continue;
            }
            for (let i = list.length - 1; i >= 0; i--) {
                const item = list[i];
                console.log(item)
                try {
                    const details = await scraper.getMangaDetails(item.key, item.cover);
                    if (!details.chapters.length) {
                        console.warn(`Failed to get details for ${item.key}`);
                        continue;
                    }
                    if (details.chapters.length > 0) {
                        await upsertManga(details);
                        const limit = pLimit(CONCURRENCY);
                        const jobs = details.chapters.map((ch) =>
                            limit(async () => {
                                try {
                                    const mangaKey = slugify(item.title);
                                    console.log(mangaKey)

                                    const chapterNumberNum = Number(ch.chapterNumber);
                                    const existing = await MangaChapter.findOne({
                                        mangaKey,
                                        chapterNumber: chapterNumberNum,
                                        totalImages: { $gt: 0 },
                                        images: { $exists: true, $not: { $size: 0 } },
                                    }).lean();
                                    if (existing) {
                                        console.log(`Skipping chapter ${ch.chapterNumber} because images already exist`);
                                        return { skipped: true };
                                    }
                                    const imagesResult = await scraper.getChapterImages(ch.url, ch.chapterNumber);
                                    if (!imagesResult || imagesResult.length === 0) {
                                        return { skipped: true };
                                    }
                                    const query = { mangaKey, chapterNumber: chapterNumberNum };
                                    const update = {
                                        $set: {
                                            mangaKey,
                                            chapterNumber: chapterNumberNum,
                                            chapterUrl: ch.url,
                                            lastTriedAt: new Date(),
                                        },
                                        $setOnInsert: {
                                            ...((!imagesResult || imagesResult.length === 0) ? {
                                                totalImages: 0,
                                                images: [],
                                            } : {}),

                                        },
                                    };
                                    if (imagesResult && imagesResult.length > 0) {
                                        update.$set.totalImages = imagesResult.length;
                                        update.$set.images = imagesResult;
                                        update.$set.imagesFetchedAt = new Date();
                                        update.$set.totalViews = 0
                                    }

                                    const result = await MangaChapter.updateOne(query, update, { upsert: true });
                                    if (result.upsertedCount > 0 || result.modifiedCount > 0) {
                                        await Manga.updateOne(
                                            { key: mangaKey },
                                            { $set: { updatedAt: new Date() } }
                                        );
                                    }
                                    return { success: true, chapterNumber: chapterNumberNum };
                                } catch (e) {
                                    console.error(`Chapter ${ch.chapterNumber} error:`, e.message);
                                }
                            })
                        );
                        await Promise.all(jobs);
                    }

                } catch (err) {
                    console.error(`Error processing manga ${item.title}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('Scrape error:', err);
    } finally {
        await scraper.close();
        await require('mongoose').connection.close().catch(() => { });
        console.log('✅ Done (DemonicScans)');
        process.exit(0);
    }
}
module.exports = { newScrap };
