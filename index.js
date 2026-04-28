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

async function processFeed() {
  try {
    const feedUrl = process.env.FEED_URL || "https://googlemerchantcenter.export.dv.nl/4ea2fef4-a44b-47cc-bbff-a5363144a581-vehicles-nl.xml";

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

    const processedItems = [];

    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      const id = item['g:id'];
      if (!id) continue;

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

      // Format price
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

      const cloudinaryPublicId = `content_lease_meta/${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      let metaImage = originalImage;

      try {
        const cloudinaryConfig = cloudinary.config();
        const hasCloudinary = process.env.CLOUDINARY_URL || (cloudinaryConfig.cloud_name && cloudinaryConfig.api_key);

        if (originalImage && hasCloudinary) {
          await cloudinary.uploader.upload(originalImage, {
            public_id: cloudinaryPublicId,
            overwrite: true
          });

          const transformation = [
            { width: 1080, height: 800, crop: 'limit' },
            { width: 1080, height: 1080, crop: 'pad', background: 'white', gravity: 'north' }
          ];

          // Add a colored bar at the bottom using a 1x1 image trick
          // Since we might not have a colored bar image, we can just use colored text backgrounds
          // Or just use the text colors.
          
          transformation.push({
            overlay: { font_family: 'Inter', font_size: 46, font_weight: 'bold', text: mainOverlayTitle },
            gravity: 'north_west', x: 60, y: 824, color: '#1a1a1a', width: 960, crop: 'fit'
          });

          if (subOverlayTitle) {
            transformation.push({
              overlay: { font_family: 'Inter', font_size: 38, text: subOverlayTitle },
              gravity: 'north_west', x: 60, y: 888, color: '#555555', width: 960, crop: 'fit'
            });
          }

          transformation.push({
            overlay: { font_family: 'Inter', font_size: 42, font_weight: '600', text: description },
            gravity: 'south_west', x: 60, y: 45, color: '#6d3ef3', width: 500, crop: 'fit' // Purple color
          });
          
          transformation.push({
            overlay: { font_family: 'Inter', font_size: 56, font_weight: 'bold', text: formattedPrice },
            gravity: 'south_east', x: 60, y: 45, color: '#2fb25d' // Green color
          });

          metaImage = cloudinary.url(cloudinaryPublicId, {
            transformation: transformation,
            secure: true,
            format: 'jpg',
            quality: 80
          });
          console.log(`  ✓ Processed image for ${id}`);
        } else {
          console.log(`  ! Skipped Cloudinary for ${id} (No CLOUDINARY_URL)`);
        }
      } catch (err) {
        console.error(`Error processing image for ${id}:`, err.message);
      }

      const finalPrice = `${parseFloat(priceVal || 0).toFixed(2)} EUR`;

      processedItems.push({
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
      });
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
