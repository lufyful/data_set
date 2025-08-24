const { chromium } = require('playwright');
const cheerio = require('cheerio');

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}
class FastDemonicScansScraper {
    constructor(options = {}) {
        this.baseUrl = 'https://demonicscans.org';
        this.browser = null;
        this.context = null;
        this.userAgent = options.userAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        this.headless = options.headless !== false;
    }

    async initBrowser(blockResources = true) {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: this.headless });
        }
        if (!this.context) {
            this.context = await this.browser.newContext({
                userAgent: this.userAgent,
                viewport: { width: 1280, height: 800 }
            });
        }
        this.blockResources = blockResources;
    }

    async gotoWithWait(page, url, selector = null) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (selector) {
            await page.waitForSelector(selector, { timeout: 7000 });
        }
    }

    async getMangaList(pageNum = 1) {
        await this.initBrowser(true);
        const page = await this.context.newPage();
        if (this.blockResources) {
            await page.route('**/*', (route) => {
                const type = route.request().resourceType();
                if (['image', 'stylesheet', 'font'].includes(type)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
        }
        try {
            const url = `${this.baseUrl}/lastupdates.php?list=${pageNum}`;
            await this.gotoWithWait(page, url, '.updates-element');
            const html = await page.content();
            const $ = cheerio.load(html);
            const mangaList = [];
            $('.updates-element').each((_, el) => {
                const $el = $(el);
                const titleLink = $el.find('a').first();
                const title = titleLink.attr('title')?.trim();
                const href = titleLink.attr('href');
                if (!title || !href) return;
                const cover = $el.find('img').attr('src') || '';
                mangaList.push({
                    key: this.generateKey(href, title),
                    title,
                    cover: encodeURI(cover.startsWith('http') ? cover : this.baseUrl + cover),
                    url: href.startsWith('http') ? href : this.baseUrl + href,
                });
            });
            return mangaList;
        } finally {
            await page.close();
        }
    }

    async getMangaDetails(key, Gcover) {
        await this.initBrowser(true);
        const page = await this.context.newPage();
        if (this.blockResources) {
            await page.route('**/*', (route) => {
                const type = route.request().resourceType();
                if (['image', 'stylesheet', 'font'].includes(type)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
        }
        try {
            const url = `${this.baseUrl}/manga/${key}`;
            await this.gotoWithWait(page, url, '#manga-info-rightColumn, h1, .big-fat-titles , #manga-page');
            const html = await page.content();
            const $ = cheerio.load(html);
            const title = $('h1, .manga-title, .series-title, .title-main').first().text().trim();
            const description = $('.white-font').first().text().trim();
            const cover = Gcover;
            const genres = [];
            $('.genres-list li').each((_, el) => genres.push($(el).text().trim()));
            const chapters = [];
            $('#chapters-list li').each((_, el) => {
                const $el = $(el);
                const chapterLink = $el.find('a').first();
                const chapterUrl = chapterLink.attr('href');
                const chapterText = chapterLink.text().trim();
                const chapterMatch = chapterText.match(/chapter\s*(\d+(?:\.\d+)?)/i) || chapterText.match(/(\d+(?:\.\d+)?)/);
                const chapterNumber = chapterMatch ? chapterMatch[1] : '';
                chapters.push({
                    chapterNumber,
                    title: chapterText,
                    url: chapterUrl.startsWith('http') ? chapterUrl : this.baseUrl + chapterUrl,
                });
            });

            return {
                key,
                title,
                cover: cover.startsWith('http') ? cover : this.baseUrl + cover,
                description,
                genres,
                chapters,
                totalChapters: chapters.length,
            };
        } finally {
            await page.close();
        }
    }

    async getChapterImages(chapterUrl, chapterNumber) {
        await this.initBrowser(false);
        const page = await this.context.newPage();
        // Do not block images for this page
        try {
            await this.gotoWithWait(page, chapterUrl, '.imgholder, img');
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(1000);
            const html = await page.content();
            const $ = cheerio.load(html);
            const images = [];
            $('.imgholder, img').each((_, el) => {
                const src = $(el).attr('src') || $(el).attr('data-src') || '';
                if (
                    src &&
                    /\.(jpg|jpeg|png|webp|gif)$/i.test(src) &&
                    (src.includes(`/${chapterNumber}/`)|| src.includes(`/${chapterNumber}./`) || src.includes(`/.${chapterNumber}/`))
                ) {
                    images.push(encodeURI(src.startsWith('http') ? src : this.baseUrl + src));
                }
            });
            return images;
        } finally {
            await page.close();
        }
    }

    generateKey(url, title) {
        const match = url.match(/\/(?:title|series|manga)\/([^\/]+)/);
        if (match) return match[1];
        return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    async close() {
        if (this.context) await this.context.close();
        if (this.browser) await this.browser.close();
        this.context = null;
        this.browser = null;
    }
}

module.exports = { FastDemonicScansScraper };