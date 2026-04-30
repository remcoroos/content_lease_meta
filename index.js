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
      'https://contentlease.nl/wp-content/uploads/2025/07/favicon-content-lease-300x300.png',
      { public_id: LOGO_PUBLIC_ID, overwrite: true }
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

    const logoOk = await ensureLogoUploaded();

    console.log(`Fetching source feed from: ${feedUrl}...`);
    const response = await axios.get(feedUrl);
    const xml = response.data;

    console.log('Parsing XML...');
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(xml);
    const allItems = result.rss.channel.item || [];
    
    // Process all items for Content Lease
    // Limit to max 500 if there are thousands, but let's process all for now.
    const itemsToProcess = Array.isArray(allItems) ? allItems : [allItems];

    console.log(`Processing ${itemsToProcess.length} items...`);

    const cloudinaryConfig = cloudinary.config();
    const hasCloudinary = process.env.CLOUDINARY_URL || (cloudinaryConfig.cloud_name && cloudinaryConfig.api_key);

    async function processItem(item) {
      const id = item['g:id'];
      if (!id) return null;

      const rawBrand = item['g:brand'] || '';
      const rawModel = item['g:model'] || '';
      const rawTitle = item['g:title'] || `${rawBrand} ${rawModel}`;

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

      const brandModelPrefix = `${rawBrand} ${rawModel}`.trim();
      let mainOverlayTitle = rawTitle;
      let subOverlayTitle = '';

      if (brandModelPrefix && rawTitle.toLowerCase().startsWith(brandModelPrefix.toLowerCase())) {
        mainOverlayTitle = rawTitle.substring(0, brandModelPrefix.length).trim();
        let remaining = rawTitle.substring(brandModelPrefix.length).trim();
        let cleaned = remaining.replace(/^[-|I]\s*/i, '');
        subOverlayTitle = cleaned.replace(/\s+[\|I]\s+/g, ' • ');
      }

      const MAX_SUB_LENGTH = 75;
      if (subOverlayTitle.length > MAX_SUB_LENGTH) {
        subOverlayTitle = subOverlayTitle.substring(0, MAX_SUB_LENGTH).replace(/\s+\S*$/, '') + ' ...';
      }

      let metaImage = originalImage;

      const transformation = [
        { width: 1080, height: 800, crop: 'limit' },
        { width: 1080, height: 1080, crop: 'pad', background: 'white', gravity: 'north' },
        { overlay: { font_family: 'Arial', font_size: 46, font_weight: 'bold', text: mainOverlayTitle },
          gravity: 'north_west', x: 60, y: 824, color: '#1a1a1a', width: 960, crop: 'fit' },
        ...(subOverlayTitle ? [{ overlay: { font_family: 'Arial', font_size: 38, text: subOverlayTitle },
          gravity: 'north_west', x: 60, y: 888, color: '#555555', width: 960, crop: 'fit' }] : []),
        { overlay: { font_family: 'Arial', font_size: 42, font_weight: '600', text: description },
          gravity: 'south_west', x: 60, y: 45, color: '#6d3ef3', width: 500, crop: 'fit' },
        { overlay: { font_family: 'Arial', font_size: 56, font_weight: 'bold', text: formattedPrice },
          gravity: 'south_east', x: 60, y: 45, color: '#2fb25d' },
        ...(logoOk ? [{ overlay: LOGO_PUBLIC_ID.replace(/\//g, ':'),
          gravity: 'north_west', x: 20, y: 20, width: 60, crop: 'fit' }] : [])
      ];

      const cloudinaryPublicId = `content_lease_meta/${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      if (originalImage && hasCloudinary) {
        try {
          await cloudinary.uploader.upload(originalImage, {
            public_id: cloudinaryPublicId,
            overwrite: true,
            unique_filename: false,
            transformation,
            format: 'jpg',
            quality: 80
          });
          metaImage = cloudinary.url(cloudinaryPublicId, { secure: true });
        } catch (err) {
          console.error(`  ✗ Failed ${id}: ${err.message}`);
        }
      }

      const finalPrice = `${parseFloat(priceVal || 0).toFixed(2)} EUR`;

      return {
        'g:id': id,
        'g:title': rawTitle,
        'g:description': description,
        'link': item['link'] || item['g:link_template'] || item['g:link'] || '',
        'g:link': item['g:link_template'] || item['g:link'] || '',
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
