const puppeteer = require("puppeteer");
const pLimit = (await import('p-limit')).default;
const mangaChapterCol = require('../models/mangaChapter.cjs');
const MangaCol = require('../models/manga.cjs');
const BASE_URL = "https://manhuafast.net";

function getCoverUrl(mangaData) {
  if (!mangaData?.cover || !mangaData.cover.includes("/uploads/")) {
    return null;
  }
  const path = mangaData.cover.split("/uploads/")[1];
  return `https://manga-for-you.onrender.com/uploads?path=${path}`;
}

class ManhuaFastScraper {
  constructor() {
    this.browser = null;
  }

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
          "--blink-settings=imagesEnabled=false",
        ],
      });
    }
  }

  async getNewPage() {
    if (!this.browser) await this.init();
    const page = await this.browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      const type = req.resourceType();
      const blockedDomains = [
        "googletagmanager.com",
        "google-analytics.com",
        "doubleclick.net",
        "adservice.google.com",
      ];
      if (
        ["image", "stylesheet", "font", "media", "other", "xhr", "fetch", "websocket", "eventsource", "manifest"].includes(type) ||
       
        blockedDomains.some((d) => url.includes(d))
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });
    return page;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // 1. Get Manga List
  async getMangaList(pageNum = 1) {
    let page;
    try {
      await this.init();
      page = await this.getNewPage();
      const url = pageNum === 1 ? `${BASE_URL}` : `${BASE_URL}/page/${pageNum}/`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3000000 });
      await page.waitForSelector(".page-item-detail", { timeout: 10000 });

      const mangaList = await page.evaluate(() => {
        const mangaItems = [];
        const elements = document.querySelectorAll(".page-item-detail");
        elements.forEach((el) => {
          const titleEl = el.querySelector(".post-title a");
          if (titleEl) {
            const title = titleEl.textContent.trim();
            const href = titleEl.getAttribute("href") || "";
            const key = href.split("/manga/")[1]?.split("/")[0] || "";
            if (title && key && href) {
              mangaItems.push({ title, key, href });
            }
          }
        });
        return mangaItems;
      });

      return { success: true, page: pageNum, total: mangaList.length, data: mangaList };
    } catch (error) {
      console.error(`❌ Error in getMangaList:`, error.message);
      return { success: false, error: error.message, data: [] };
    } finally {
      if (page) await page.close();
    }
  }

  // 2. Get Manga Details
  async getMangaDetails(key) {
    let page;
    try {
      await this.init();
      page = await this.getNewPage();
      const url = `${BASE_URL}/manga/${key}`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 3000000 });
      await page.waitForSelector(".post-title h1", { timeout: 10000 });

      const mangaData = await page.evaluate(() => {
        const titleSelectors = [
          ".post-title h1",
          "h1.entry-title",
          ".manga-title",
          "h1",
          ".title h1",
          ".post-content h1",
        ];
        let title = "";
        for (const selector of titleSelectors) {
          const titleEl = document.querySelector(selector);
          if (titleEl && titleEl.textContent.trim()) {
            title = titleEl.textContent.trim();
            break;
          }
        }
        if (!title) {
          title = document.title.split("|")[0].split("-")[0].trim();
        }
        // Get cover image
        const coverSelectors = [
          ".summary_image img",
          ".manga-cover img",
          ".post-thumb img",
          ".entry-content img:first-of-type",
          'img[alt*="cover" i]',
          'img[src*="cover" i]',
        ];
        let cover = "";
        for (const selector of coverSelectors) {
          const coverEl = document.querySelector(selector);
          if (coverEl && coverEl.src && coverEl.src.startsWith("http") && coverEl.src.includes("/uploads/")) {
            cover = coverEl.src;
            break;
          }
        }
        let description = "";
        const descSelectors = [
          ".summary__content",
          ".summary .summary__content",
          ".description-summary",
          ".manga-excerpt",
          ".post-content .summary",
          ".post-content .description",
        ];
        for (const selector of descSelectors) {
          const descEl = document.querySelector(selector);
          if (descEl && descEl.textContent.trim()) {
            description = descEl.textContent.trim();
            break;
          }
        }
        let genres = [];
        const genreSelectors = [
          ".genres-content a",
          ".genres a",
          ".manga-genres a",
          ".genres-content",
        ];
        for (const selector of genreSelectors) {
          const genreEls = document.querySelectorAll(selector);
          if (genreEls.length) {
            genres = Array.from(genreEls)
              .map((el) => el.textContent.trim())
              .filter(Boolean);
            if (genres.length) break;
          }
        }
        // Get chapters
        const chapters = [];
        const chapterElements = document.querySelectorAll(".wp-manga-chapter");
        chapterElements.forEach((el) => {
          const titleEl = el.querySelector("a");
          const releaseDateEl = el.querySelector("i");
          if (titleEl) {
            const chapterTitle = titleEl.textContent.trim();
            const chapterUrl = titleEl.getAttribute("href") || "";
            const releaseDate = releaseDateEl
              ? releaseDateEl.textContent.trim()
              : "";
            const numberMatch =
              chapterTitle.match(/(?:Chapter|Ch\.?)\s*([\d.]+)/i) ||
              chapterTitle.match(/^([\d.]+)/) ||
              chapterTitle.match(/([\d.]+)/);
            if (chapterUrl && numberMatch && chapterTitle.length > 0) {
              const fullUrl = chapterUrl.startsWith("http")
                ? chapterUrl
                : `${window.location.origin}${chapterUrl}`;
              chapters.push({
                number: numberMatch[1],
                title: chapterTitle,
                url: fullUrl,
                releaseDate: releaseDate,
              });
            }
          }
        });
        return {
          title,
          cover,
          description,
          genres,
          chapters: chapters.sort(
            (a, b) => parseFloat(b.number) - parseFloat(a.number)
          ),
        };
      });
      return {
        success: true,
        data: {
          title: mangaData.title || `Unknown (${key})`,
          key,
          cover: mangaData.cover || "",
          description: mangaData.description || "",
          genres: mangaData.genres || [],
          totalChapters: mangaData.chapters.length,
          chapters: mangaData.chapters,
          detailUrl: url,
        },
      };
    } catch (error) {
      console.error(`❌ Error in getMangaDetails for ${key}:`, error.message);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    } finally {
      if (page) await page.close();
    }
  }

  // 3. Get Chapter Images
  async getChapterImages(key, chapterNumber) {
    let page;
    try {
      await this.init();
      // Get manga details to find the chapter URL
      const details = await this.getMangaDetails(key);
      if (!details.success) {
        return { success: false, error: "Manga not found" };
      }
      const chapter = details.data.chapters.find(
        (c) => c.number === chapterNumber || c.number === String(chapterNumber)
      );
      if (!chapter) {
        return { success: false, error: "Chapter not found" };
      }
      page = await this.getNewPage();
      await page.goto(chapter.url, { waitUntil: "networkidle2", timeout: 3000000 });
      await page.waitForSelector(".reading-content", { timeout: 10000 });
      const images = await page.evaluate(() => {
        const imageElements = document.querySelectorAll(".reading-content img");
        const imageUrls = [];
        imageElements.forEach((img) => {
          const src =
            img.src ||
            img.getAttribute("data-src") ||
            img.getAttribute("data-lazy-src");
          if (src && src.startsWith("http")) {
            imageUrls.push(src);
          }
        });
        return imageUrls;
      });
      return {
        success: true,
        data: {
          mangaTitle: details.data.title,
          mangaKey: key,
          chapterNumber,
          totalImages: images.length,
          images,
          chapterUrl: chapter.url,
        },
      };
    } catch (error) {
      console.error(`❌ Error in getChapterImages:`, error.message);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    } finally {
      if (page) await page.close();
    }
  }

  // New: fetch by chapter URL only (no extra details page)
  async getChapterImagesByUrl(chapterUrl, mangaTitle, key, chapterNumber) {
    let page;
    try {
      await this.init();
      page = await this.getNewPage();
      await page.goto(chapterUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector(".reading-content", { timeout: 15000 });
      const images = await page.evaluate(() => {
        const els = document.querySelectorAll(".reading-content img");
        const urls = [];
        els.forEach((img) => {
          const src = img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-cfsrc");
          if (src && /^https?:\/\//i.test(src)) urls.push(src);
        });
        return urls;
      });
      return {
        success: true,
        data: {
          mangaTitle,
          mangaKey: key,
          chapterNumber,
          totalImages: images.length,
          images,
          chapterUrl,
        },
      };
    } catch (error) {
      return { success: false, error: error.message, data: null };
    } finally {
      if (page) await page.close();
    }
  }
}

async function scrapeAllMangaAllChapters(pages = 5) {
  const scraper = new ManhuaFastScraper();
  const limit = pLimit(1); // 3 concurrent chapter scrapes
  try {
    for (let page = 1; page <= pages; page++) {
      const listResult = await scraper.getMangaList(page);
      if (listResult.success) {
        for (const manga of listResult.data) {
          console.log(manga.key)
          const details = await scraper.getMangaDetails(manga.key);
          console.log(details)
          if (details.success && details.data.chapters.length > 0) {
            // UPSERT Manga
            await MangaCol.findOneAndUpdate(
              { key: details.data.key },
              {
                $set: {
                  key: details.data.key,
                  title: details.data.title,
                  cover: details.data.cover,
                  description: details.data.description,
                  genres: details.data.genres,
                  totalChapters: details.data.totalChapters,
                },
              },
              { upsert: true, new: true }
            );
            // Parallelize chapter scraping
             console.log(chapter.number)
            const chapterPromises = details.data.chapters.map(chapter =>
              limit(async () => {
                // Check if already exists with images
                const existing = await mangaChapterCol.findOne({
                  mangaKey: details.data.key,
                  chapterNumber: Number(chapter.number),
                  totalImages: { $gt: 0 },
                  images: { $exists: true, $not: { $size: 0 } }
                });
                if (existing) return; // Skip
                const imagesResult = await scraper.getChapterImagesByUrl(chapter.url,
                  details.data.title,
                  details.data.key,
                  chapter.number);
                const query = { mangaKey: details.data.key, chapterNumber: Number(chapter.number) };
                const update = {
                  $set: {
                    mangaKey: details.data.key,
                    chapterNumber: Number(chapter.number),
                  },
                  $setOnInsert: {
                    totalImages: 0,
                    images: [],
                  }
                };
                if (imagesResult.success && imagesResult.data.totalImages > 0) {
                  console.log(imagesResult.data)
                  update.$set.totalImages = imagesResult.data.totalImages;
                  update.$set.images = imagesResult.data.images;
                  update.$set.chapterUrl = imagesResult.data.chapterUrl;
                }
                await mangaChapterCol.updateOne(query, update, { upsert: true });
              })
            );
            await Promise.all(chapterPromises);
          }
        }
      }
    }
  } catch (err) {
    console.error('Scraping error:', err);
  } finally {
    await scraper.close();
  }
}

module.exports = { scrapeAllMangaAllChapters };