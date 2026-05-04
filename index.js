import axios from 'axios';
import xml2js from 'xml2js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.CLOUDINARY_URL) {
  // CLOUDINARY_URL auto-configures if present
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const LOGO_PUBLIC_ID = 'content_lease_meta/_logo';

async function ensureLogoUploaded() {
  const cloudinaryConfig = cloudinary.config();
  const hasCloudinary = process.env.CLOUDINARY_URL || (cloudinaryConfig.cloud_name && cloudinaryConfig.api_key);
  if (!hasCloudinary) return false;
  try {
    await cloudinary.uploader.upload(
      'https://content-lease-meta.vercel.app/content-lease-logo_icon_753bfb.svg',
      { public_id: LOGO_PUBLIC_ID, overwrite: true, invalidate: true }
    );
    console.log('Logo uploaded to Cloudinary');
    return true;
  } catch (err) {
    console.error('Logo upload failed:', err.message);
    return false;
  }
}

async function processFeed() {
  try {
    const feedUrl = process.env.FEED_URL || "https://googlemerchantcenter.export.dv.nl/4ea2fef4-a44b-47cc-bbff-a5363144a581-vehicles-nl.xml";
    const maxItems = process.env.MAX_ITEMS ? parseInt(process.env.MAX_ITEMS, 10) : 0;
    const bgRemoval = process.env.BG_REMOVAL === 'true';

    const logoOk = await ensureLogoUploaded();

    console.log(`Fetching source feed from: ${feedUrl}...`);
    if (maxItems > 0) console.log(`Test modus: max ${maxItems} voertuigen`);
    if (bgRemoval) console.log('AI achtergrond verwijdering actief');

    const response = await axios.get(feedUrl);
    const xml = response.data;

    console.log('Parsing XML...');
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(xml);
    const allItems = result.rss.channel.item || [];

    const allItemsArr = Array.isArray(allItems) ? allItems : [allItems];
    const itemsToProcess = maxItems > 0 ? allItemsArr.slice(0, maxItems) : allItemsArr;

    console.log(`Processing ${itemsToProcess.length} items...`);

    const cloudinaryConfig = cloudinary.config();
    const hasCloudinary = process.env.CLOUDINARY_URL || (cloudinaryConfig.cloud_name && cloudinaryConfig.api_key);

    async function processItem(item) {
      const id = item['g:id'];
      if (!id) return null;

      const rawBrand = item['g:brand'] || '';
      const rawModel = item['g:model'] || '';
      let rawTitle = item['g:title'] || `${rawBrand} ${rawModel}`;
      const MAX_TITLE_LENGTH = 150;
      if (rawTitle.length > MAX_TITLE_LENGTH) {
        rawTitle = rawTitle.substring(0, MAX_TITLE_LENGTH).replace(/\s+\S*$/, '').trim();
      }

      const priceString = item['g:price'] || '';
      const originalImage = item['g:image_link'];

      const rawMileage = item['g:mileage'] || '';
      let mileage = rawMileage;
      if (mileage) {
        const numMileage = mileage.replace(/\D/g, '');
        if (numMileage) {
          mileage = `${new Intl.NumberFormat('nl-NL').format(numMileage)} km`;
        }
      }
      const year = item['g:year'] || '';
      const description = [mileage, year].filter(Boolean).join(' • ') || `Bekijk alle details bij Content Lease.`;

      const priceVal = priceString.split(' ')[0] || '0';
      const formattedPrice = `€ ${new Intl.NumberFormat('nl-NL').format(priceVal)},-`;

      const rawDescription = item['g:description'] || '';
      const leasePriceMatch = rawDescription.match(/Leaseprijs.*?vanaf[^0-9]*([\d.,]+)\s*p\/m/i);
      const leaseLabel = leasePriceMatch ? `v.a. € ${leasePriceMatch[1]} p/m` : '';

      const brandModelPrefix = `${rawBrand} ${rawModel}`.trim();
      let mainOverlayTitle = rawTitle;
      let subOverlayTitle = '';

      const normStr = s => s.normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[-\s]+/g, ' ')
        .toLowerCase()
        .replace(/([a-z])(\d)/g, '$1 $2')
        .replace(/(\d)([a-z])/g, '$1 $2')
        .trim();

      if (brandModelPrefix) {
        const normTitle = normStr(rawTitle);
        const normBrand = normStr(rawBrand);
        const normModel = normStr(rawModel);
        const brandParts = rawBrand.split(/[-\s]/);
        const modelParts = rawModel.split(/[-\s]/);

        // Try prefixes from specific to general until one matches
        const candidates = [
          normStr(rawBrand + ' ' + rawModel),
          modelParts.length > 1 ? normStr(rawBrand + ' ' + modelParts[0]) : null,
          brandParts.length > 1 ? normStr(brandParts[0] + ' ' + rawModel) : null,
          brandParts.length > 1 && modelParts.length > 1 ? normStr(brandParts[0] + ' ' + modelParts[0]) : null,
          (normModel.startsWith(normBrand + ' ') || normModel === normBrand) ? normModel : null,
        ].filter(Boolean);

        let prefixWordCount = 0;
        for (const c of candidates) {
          if (c && normTitle.startsWith(c)) { prefixWordCount = c.split(' ').filter(Boolean).length; break; }
        }

        if (prefixWordCount > 0) {
          let pos = 0, words = 0;
          while (pos < rawTitle.length && words < prefixWordCount) {
            while (pos < rawTitle.length && /[\s\-]/.test(rawTitle[pos])) pos++;
            while (pos < rawTitle.length && !/[\s\-]/.test(rawTitle[pos])) pos++;
            words++;
          }
          mainOverlayTitle = rawTitle.substring(0, pos).trim();
          let remaining = rawTitle.substring(pos).trim();
          let cleaned = remaining.replace(/^[-|I]\s*/i, '');
          subOverlayTitle = cleaned.replace(/\s+[\|I]\s+/g, ' • ');
        }
      }

      const MAX_SUB_LENGTH = 75;
      if (subOverlayTitle.length > MAX_SUB_LENGTH) {
        subOverlayTitle = subOverlayTitle.substring(0, MAX_SUB_LENGTH).replace(/\s+\S*$/, '') + ' ...';
      }

      let metaImage = originalImage;

      const transformation = [
        ...(bgRemoval ? [{ effect: 'background_removal' }, { effect: 'trim:10' }] : []),
        { width: 1080, height: 700, crop: 'lpad', background: 'rgb:f2f0ed' },
        { width: 1080, height: 704, crop: 'pad', background: 'rgb:f2f0ed' },
        { width: 1080, height: 1080, crop: 'pad', background: 'white', gravity: 'north', y: 130 },
        { overlay: { font_family: 'Arial', font_size: 50, font_weight: 'bold', text: mainOverlayTitle },
          gravity: 'north_west', x: 60, y: 840, color: '#1c0a30', width: 960, crop: 'fit' },
        ...(subOverlayTitle ? [{ overlay: { font_family: 'Arial', font_size: 34, text: subOverlayTitle },
          gravity: 'north_west', x: 60, y: 904, color: '#555555', width: 600, crop: 'fit' }] : []),
        { overlay: { font_family: 'Arial', font_size: 34, text: formattedPrice },
          gravity: 'north_east', x: 60, y: 916, color: '#555555' },
        { overlay: { font_family: 'Arial', font_size: 36, font_weight: '600', text: description },
          gravity: 'south_west', x: 60, y: 52, color: '#555555', width: 500, crop: 'fit' },
        ...(leaseLabel ? [{ overlay: { font_family: 'Arial', font_size: 68, font_weight: 'bold', text: leaseLabel },
          gravity: 'south_east', x: 60, y: 38, color: '#2fb25d' }] : []),
        { overlay: { font_family: 'Arial', font_size: 38, font_weight: 'bold', text: 'Financial Lease' },
          gravity: 'north_east', x: 60, y: 30, color: '#1c0a30' },
        ...(logoOk ? [{ overlay: LOGO_PUBLIC_ID.replace(/\//g, ':'),
          gravity: 'north_west', x: 60, y: 20, height: 90, crop: 'fit' }] : [])
      ];

      const cloudinaryPublicId = `content_lease_meta/${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      if (originalImage && hasCloudinary) {
        try {
          await cloudinary.uploader.upload(originalImage, {
            public_id: cloudinaryPublicId,
            overwrite: true,
            invalidate: true,
            unique_filename: false
          });
        } catch (err) {
          console.error(`  ✗ Failed ${id}: ${err.message}`);
        }
        metaImage = cloudinary.url(cloudinaryPublicId, {
          transformation,
          secure: true,
          format: 'jpg',
          quality: 80,
          force_version: false
        });
      }

      const finalPrice = `${parseFloat(priceVal || 0).toFixed(2)} EUR`;

      const cleanLink = (item['g:link_template'] || item['g:link'] || item['link'] || '')
        .replace(/[?&][^?&]*\{[^}]+\}[^?&]*/g, '')  // remove params with template vars
        .replace(/\{[^}]+\}/g, '')                    // remove any remaining template vars
        .replace(/[?&]$/, '');                         // clean trailing ? or &

      return {
        'g:id': id,
        'g:item_group_id': id,
        'g:title': rawTitle,
        'g:description': description,
        'link': cleanLink,
        'g:link': cleanLink,
        'g:image_link': metaImage,
        'g:brand': rawBrand,
        'g:model': rawModel,
        'g:condition': item['g:condition'] || 'used',
        'g:availability': 'in stock',
        'g:price': finalPrice,
        'g:year': year,
        'g:mileage': rawMileage
      };
    }

    const CONCURRENCY = 12;
    const processedItems = [];
    for (let i = 0; i < itemsToProcess.length; i += CONCURRENCY) {
      const batch = itemsToProcess.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(processItem));
      processedItems.push(...results.filter(Boolean));
      const done = Math.min(i + CONCURRENCY, itemsToProcess.length);
      console.log(`  ${done}/${itemsToProcess.length} processed`);
    }

    console.log('Generating Meta Feed XML...');
    const builder = new xml2js.Builder();
    const finalXml = builder.buildObject({
      rss: {
        $: { 'xmlns:g': 'http://base.google.com/ns/1.0', version: '2.0' },
        channel: {
          title: 'Content Lease - Meta Product Feed',
          description: 'Geoptimaliseerde feed (Facebook/Instagram Ads)',
          link: 'https://www.contentlease.nl',
          item: processedItems
        }
      }
    });

    await fs.ensureDir(path.join(__dirname, 'public'));
    await fs.writeFile(path.join(__dirname, 'public', 'meta-product-feed.xml'), finalXml);
    await fs.writeFile(path.join(__dirname, 'public', 'last_updated.txt'), new Date().toISOString());
    console.log('Done! Feed generated in public/meta-product-feed.xml');

  } catch (err) {
    console.error('Fatal execution error:', err.message);
    throw err;
  }
}

processFeed();
