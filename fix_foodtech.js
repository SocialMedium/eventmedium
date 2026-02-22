require('dotenv').config();
const {dbRun, dbGet} = require('./db');
(async () => {
  // Fix existing SF edition
  await dbRun(
    `UPDATE events SET 
      description = 'Future Food-Tech — the premier Food & Agriculture innovation summit in San Francisco.',
      event_date = '2026-03-19',
      end_date = '2026-03-20'
    WHERE name ILIKE '%future food tech%' AND city ILIKE '%san francisco%'`
  );
  console.log('Fixed SF edition');

  // Add Chicago edition
  var chicago = await dbGet(`SELECT id FROM events WHERE name ILIKE '%future food tech%' AND city ILIKE '%chicago%'`);
  if (!chicago) {
    await dbRun(
      `INSERT INTO events (name, description, city, country, event_date, end_date, themes, event_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        'Future Food-Tech Chicago',
        'Future Food-Tech Chicago — sustainable proteins, alt ingredients, and food innovation partnerships.',
        'Chicago', 'United States',
        '2026-06-15', '2026-06-16',
        '["Food & Agriculture","Sustainability","Deep Tech"]',
        'https://www.futurefoodtechchicago.com/'
      ]
    );
    console.log('Added Chicago edition');
  } else {
    console.log('Chicago edition already exists');
  }

  // Add London edition
  var london = await dbGet(`SELECT id FROM events WHERE name ILIKE '%future food tech%' AND city ILIKE '%london%'`);
  if (!london) {
    await dbRun(
      `INSERT INTO events (name, description, city, country, event_date, end_date, themes, event_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        'Future Food-Tech London',
        'Future Food-Tech London — breakthrough technologies and partnerships shaping the future of food.',
        'London', 'United Kingdom',
        '2026-09-24', '2026-09-25',
        '["Food & Agriculture","Sustainability","Deep Tech"]',
        'https://www.futurefoodtechlondon.com/'
      ]
    );
    console.log('Added London edition');
  } else {
    console.log('London edition already exists');
  }

  process.exit(0);
})();
