// manhuafast-http-scraper.js
// Cheerio-first with Puppeteer fallback, using Node 18+/20+ global fetch (no 'got' needed).
'use strict';

const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { setTimeout: delay } = require('timers/promises');

const BASE_URL = 'https://manhuafast.net';

function abs(url, base = BASE_URL) {
    try {
        if (!url) return '';
        return /^https?:\/\//i.test(url) ? url : new URL(url, base).href;
    } catch {
        return url || '';
    }
}

const DEFAULT_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
};

async function httpGet(url, { headers = {}, timeout = 20000, retries = 2 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { headers: { ...DEFAULT_HEADERS, ...headers }, signal: controller.signal });
            const text = await res.text(); // do not throw on !ok; we detect CF/blocked via content
            return text;
        } catch (e) {
            if (attempt === retries) throw e;
            await delay(500 * (attempt + 1));
        } finally {
            clearTimeout(t);
        }
    }
    return '';
}

function looksBlockedOrChallenged(html) {
    if (!html) return true;
    const lc = html.toLowerCase();
    if (lc.includes('cf-browser-verification')) return true;
    if (lc.includes('checking your browser') && lc.includes('cloudflare')) return true;
    if (lc.includes('just a moment')) return true;
    if (lc.includes('attention required') && lc.includes('cloudflare')) return true;
    return false;
}

function hasSelector(html, selector) {
    if (!selector) return true;
    try {
        const $ = cheerio.load(html);
        return $(selector).length > 0;
    } catch {
        return false;
    }
}

// Attributes and helpers for robust image extraction
const CANDIDATE_ATTRS = [
    'src',
    'data-src',
    'data-lazy-src',
    'data-cfsrc',
    'data-original',
    'data-echo',
    'data-src-original',
    'data-orig-file',
    'data-url',
    'data-image',
    'data-lazy',
    'data-lazyload',
    'data-lazy-url',
    'data-thumb-url',
    'data-thumbnail',
    'data-ks-lazyload',
    'data-llsrc',
];

function pickFromSrcset(srcset) {
    if (!srcset) return '';
    const items = srcset.split(',').map((s) => s.trim()).filter(Boolean);
    if (!items.length) return '';
    let bestUrl = '';
    let bestScore = -1;
    for (const item of items) {
        const parts = item.split(/\s+/);
        const url = parts[0];
        let score = 1;
        const w = item.match(/\s(\d+)\s*w/i);
        const x = item.match(/\s(\d+(?:\.\d+)?)\s*x/i);
        if (w) score = parseFloat(w[1]);
        else if (x) score = parseFloat(x[1]) * 1000;
        if (url && score > bestScore) {
            bestScore = score;
            bestUrl = url;
        }
    }
    return bestUrl;
}

function collectChapterImagesFromHtml(html, baseUrl) {
    try {
        const $ = cheerio.load(html);
        let urls = [];

        $('.reading-content img').each((_, img) => {
            const el = $(img);
            let u = '';
            for (const attr of CANDIDATE_ATTRS) {
                u = el.attr(attr);
                if (u) break;
            }
            if (!u) {
                u = pickFromSrcset(el.attr('srcset')) || pickFromSrcset(el.attr('data-srcset')) || '';
            }
            if (u) urls.push(u);
        });

        $('.reading-content noscript').each((_, ns) => {
            const inner = $(ns).html() || '';
            if (!inner) return;
            const $$ = cheerio.load(inner);
            $$('img').each((__, nimg) => {
                const el = $$(nimg);
                let u = el.attr('src') || el.attr('data-src') || pickFromSrcset(el.attr('srcset')) || pickFromSrcset(el.attr('data-srcset')) || '';
                if (u) urls.push(u);
            });
        });

        urls = urls.filter(Boolean).map((u) => abs(u, baseUrl));
        const seen = new Set();
        urls = urls.filter((u) => {
            if (!/^https?:\/\//i.test(u)) return false;
            const k = u.trim();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        console.log(urls)
        return urls;
    } catch {
        return [];
    }
}

class PuppeteerFetcher {
    constructor(opts = {}) {
        this.browser = null;
        this.headless = opts.headless ?? true;
        this.args = opts.args || [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-zygote',
            '--disable-gpu',
        ];
        this.userAgent =
            opts.userAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';
    }

    async init() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: this.headless,
                args: this.args,
            });
        }
    }

    async fetchHtml(url, { waitForSelector, timeout = 45000 } = {}) {
        await this.init();
        const page = await this.browser.newPage();
        try {
            await page.setUserAgent(this.userAgent);
            await page.setViewport({ width: 1365, height: 900 });

            await page.setRequestInterception(true);
            const origin = new URL(url).origin;
            const blockedDomains = [
                'googletagmanager.com',
                'google-analytics.com',
                'doubleclick.net',
                'adservice.google.com',
            ];
            page.on('request', (req) => {
                const type = req.resourceType();
                const rUrl = req.url();
                const sameOrigin = rUrl.startsWith(origin);
                if (blockedDomains.some((d) => rUrl.includes(d))) return req.abort();
                if (['image', 'font', 'media', 'stylesheet', 'manifest'].includes(type)) return req.abort();
                if (!sameOrigin && (type === 'script' || type === 'xhr' || type === 'fetch')) return req.abort();
                return req.continue();
            });

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
            if (waitForSelector) {
                await page.waitForSelector(waitForSelector, { timeout: Math.min(20000) }).catch(() => { });
            } else {
                await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => { });
            }

            const html = await page.content();
            return html;
        } finally {
            await page.close().catch(() => { });
        }
    }

    async close() {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch { }
            this.browser = null;
        }
    }
}

class ManhuaFastScraper {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || BASE_URL;
        this.puppeteer = new PuppeteerFetcher(options.puppeteer || {});
    }

    async fetchHtmlWithFallback(url, { detectSelector, waitForSelector } = {}) {
        try {
            const html = await httpGet(url);
            if (!looksBlockedOrChallenged(html) && hasSelector(html, detectSelector)) {
                return { html, source: 'http' };
            }
        } catch { }
        const html = await this.puppeteer.fetchHtml(url, { waitForSelector });
        return { html, source: 'puppeteer' };
    }

    async getMangaList(pageNum = 1) {
        const url = pageNum === 1 ? this.baseUrl : `${this.baseUrl}/page/${pageNum}/`;
        const { html, source } = await this.fetchHtmlWithFallback(url, {
            detectSelector: '.page-item-detail',
            waitForSelector: '.page-item-detail',
        });
        const $ = cheerio.load(html);
        const data = [];
        $('.page-item-detail').each((_, el) => {
            const a = $(el).find('.post-title a').first();
            const title = a.text().trim();
            const href = a.attr('href') || '';

            let cover = $(el).find('.img-responsive').attr('data-src')
                || $(el).find('.img-responsive').attr('data-lazy-src')
                || $(el).find('.img-responsive').attr('src')
                || '';

            if (cover.includes('/uploads/')) {
                cover = cover;
            } else {
                console.log('Placeholder, skipping:', cover);
                cover = '';
            }
            const key = href.split('/manga/')[1]?.split('/')[0] || '';
            if (title && key && href) data.push({ title, key, cover, href: abs(href, url) });
        });

        return { success: true, page: pageNum, total: data.length, data, source };
    }

    async getMangaDetails(key, cover) {
        const url = `${this.baseUrl}/manga/${key}`;

        // Use Puppeteer directly for chapters extraction
        await this.puppeteer.init();
        const page = await this.puppeteer.browser.newPage();

        try {
            await page.setUserAgent(this.puppeteer.userAgent);
            await page.setViewport({ width: 1366, height: 900 });

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
            await page.waitForSelector('ul.main.version-chap', { timeout: 20000 });

            // Extract chapters from DOM in page context
            const chapters = await page.evaluate(() => {
                const lis = document.querySelectorAll('ul.main.version-chap li');
                const chaptersArray = [];
                lis.forEach(li => {
                    const a = li.querySelector('a');
                    if (!a) return;
                    const href = a.href || '';
                    const chapterTitle = a.textContent.trim();

                    const releaseDateEl = li.querySelector('.chapter-release-date i');
                    const releaseDate = releaseDateEl ? releaseDateEl.textContent.trim() : '';

                    const numberMatch = chapterTitle.match(/(?:Chapter|Ch\.?)\s*([\d.]+)/i)
                        || chapterTitle.match(/^([\d.]+)/)
                        || chapterTitle.match(/([\d.]+)/);
                    if (!href || !numberMatch) return;

                    chaptersArray.push({
                        number: numberMatch[1],
                        title: chapterTitle,
                        url: href,
                        releaseDate,
                    });
                });
                // Sort descending by chapter number
                chaptersArray.sort((a, b) => parseFloat(b.number) - parseFloat(a.number));
                return chaptersArray;
            });

            // After chapters extraction, get page content to parse other details with Cheerio
            const html = await page.content();
            const $ = cheerio.load(html);

            let title =
                $('.post-title h1, h1.entry-title, .manga-title, .title h1').first().text().trim() ||
                $('title').text().split('|')[0].split('-')[0].trim() ||
                `Unknown (${key})`;

            let description =
                $('.summary__content, .summary .summary__content, .description-summary, .manga-excerpt, .post-content .summary, .post-content .description')
                    .first()
                    .text()
                    .trim() || '';

            let genres = [];
            const genreEls = $('.genres-content a, .genres a, .manga-genres a');
            if (genreEls.length) {
                genres = genreEls
                    .map((_, e) => $(e).text().trim())
                    .get()
                    .filter(Boolean);
            }
            return {
                success: true,
                data: {
                    title,
                    key,
                    cover,
                    description,
                    genres,
                    totalChapters: chapters.length,
                    chapters,
                    detailUrl: url,
                },
                source: 'puppeteer',
            };
        } finally {
            await page.close();
        }
    }



    async getChapterImages(chapterUrl) {
        const { html, source } = await this.fetchHtmlWithFallback(chapterUrl, {
            detectSelector: '.reading-content img',
            waitForSelector: '.reading-content',
        });

        const images = collectChapterImagesFromHtml(html, chapterUrl);

        return { success: true, data: { chapterUrl, totalImages: images.length, images }, source };
    }

    async close() {
        // const comic = await searchManga("The Demonic Cult Instructor Returns");
        // console.log(comic,"comic")
        await this.puppeteer.close();
    }
}

module.exports = { ManhuaFastScraper, BASE_URL };

const axios = require('axios');
//seach by text
async function searchManga(term) {
    const url = 'https://manhuafast.net/wp-admin/admin-ajax.php';
    const params = new URLSearchParams();
    params.append('action', 'wp-manga-search-manga');
    params.append('title', term);

    const response = await axios.post(url, params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
        }
    });

    if (response.data.success) {
        return response.data.data; // array of manga results with title, url, type
    }
    return [];
}
