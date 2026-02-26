require('dotenv').config();
const { Client } = require('pg');

const PARENT_ID = 49; // SXSW in your DB

const sidecars = [
  // ── Thu Mar 5 (Pre-SXSW) ──
  { date:'2026-03-05', start:'17:30', end:'19:30', org:'Workroom (by UNMUTE)', name:'SXSW 2026 Crash Course', addr:'', cost:'Free', tags:['Session','Networking','Tech','Education'], url:'https://luma.com/l8og56ym' },

  // ── Tue Mar 10 ──
  { date:'2026-03-10', start:'08:00', end:'16:00', org:'AI Startup Rodeo', name:'AI Startup Rodeo @ SXSW (Day 1)', addr:'TCEA 3100 Alvin Devane Blvd, Austin TX', cost:'$25-150', tags:['Session','Networking','AI','Tech'], url:'https://luma.com/jvi9l17h' },
  { date:'2026-03-10', start:'11:30', end:'13:30', org:'Red Fridge Society', name:'Lunch Society: State of VC and Growth Equity', addr:'508 Oakland Ave, Austin TX', cost:'Free', tags:['Session','Networking','Tech'], url:'https://luma.com/zgt4xrmd', invite:true },
  { date:'2026-03-10', start:'18:00', end:'21:00', org:'Open Source Analytics', name:'Open Lakehouse and AI', addr:'Q-Branch 200 E 6th St #310, Austin TX', cost:'Free', tags:['Session','Networking','AI','Tech'], url:'https://luma.com/2cxlufyd' },
  { date:'2026-03-10', start:'18:00', end:'20:00', org:'Christopher Carew', name:'Founders & Investors BBQ', addr:'', cost:'Free', tags:['Networking','Tech'], url:'https://luma.com/d82scalc' },

  // ── Wed Mar 11 ──
  { date:'2026-03-11', start:'08:00', end:'16:00', org:'AI Startup Rodeo', name:'AI Startup Rodeo @ SXSW (Day 2)', addr:'TCEA 3100 Alvin Devane Blvd, Austin TX', cost:'Free', tags:['Session','Networking','AI','Tech'], url:'https://luma.com/jvi9l17h' },
  { date:'2026-03-11', start:'09:45', end:'12:30', org:'zant app', name:'Women Fully Loaded', addr:'Central Texas Gun Works, Austin TX', cost:'Free', tags:['Special Event','Networking','Culture'], url:'https://luma.com/u8k6xix8' },
  { date:'2026-03-11', start:'12:00', end:'14:00', org:'Christopher Carew', name:'Touch Grass Tech Picnic', addr:'', cost:'Free', tags:['Networking','Party','Tech'], url:'https://luma.com/7k05rfa5' },
  { date:'2026-03-11', start:'13:00', end:'18:00', org:'ayana Foundation', name:'Ayana Rising: Women of the New Frontier', addr:'1114 E Cesar Chavez St, Austin TX', cost:'Free-$100', tags:['Networking','Session','Culture'], url:'https://luma.com/77umpcit' },
  { date:'2026-03-11', start:'15:00', end:'19:00', org:'Redbreast Whiskey', name:'Redbreast Unhidden Showcase', addr:'Alamo Drafthouse Theater, Austin TX', cost:'Free', tags:['Screening','Film/TV','Special Event'], url:'https://www.redbreastwhiskey.com/en-us/redbreast-unhiddensxsw/' },
  { date:'2026-03-11', start:'15:00', end:'20:30', org:'The Reverent Few', name:'Porchella 2026', addr:'E. 41st & Barrow Ave, Austin TX', cost:'Free', tags:['Music','Party','Culture'], url:'https://www.eventbrite.com/e/porchella-2026-the-reverent-fews-5th-annual-sxsw-porch-party-tickets-1982688241904' },
  { date:'2026-03-11', start:'16:00', end:'18:00', org:'German Accelerator', name:'The Austin Chapter: Startup Germany Meets Texas', addr:'Capital Factory 701 Brazos St, Austin TX', cost:'Free', tags:['Networking','Session','Tech'], url:'https://luma.com/xlcc8qrk' },
  { date:'2026-03-11', start:'17:00', end:'22:00', org:'Mike Garlington', name:'Network Before the Noise: Defense + Innovation Social', addr:'Q-Branch 200 E 6th St, Austin TX', cost:'Free', tags:['Networking','Party','Tech'], url:'https://luma.com/ih7kiypt' },
  { date:'2026-03-11', start:'17:30', end:'19:00', org:'dreambloc', name:'Dream Wealth Camp SXSW Reception', addr:'', cost:'Free', tags:['Networking','Party','Tech'], url:'https://luma.com/SXSWDWCCBV' },
  { date:'2026-03-11', start:'18:45', end:'21:00', org:'Christopher Carew', name:'Pre-SXSW Tech Mixer', addr:'', cost:'Free', tags:['Networking','Tech'], url:'https://luma.com/xmu1j0xl' },
  { date:'2026-03-11', start:'20:00', end:'23:59', org:'Redbreast Whiskey', name:'Redbreast Unhidden Bar (Wed)', addr:'Powder Room, 301 W 5th St, Austin TX', cost:'Free', tags:['Lounge','Party'], url:'https://www.redbreastwhiskey.com/en-us/redbreast-unhiddensxsw/' },

  // ── Thu Mar 12 (SXSW Day 1) ──
  { date:'2026-03-12', start:'08:00', end:'10:00', org:'Marque Ventures', name:'Bullets & Beans Meetup', addr:'Brew and Brew, 500 San Marcos St, Austin TX', cost:'Free', tags:['Session','Networking','Tech'], url:'https://www.eventbrite.com/e/bullets-beans-sxsw-tickets-1981331775677' },
  { date:'2026-03-12', start:'08:30', end:'10:30', org:'Damon Clinkscales', name:'Austin Open Coffee Club', addr:'', cost:'$10', tags:['Networking','Tech','Session'], url:'https://luma.com/oevwu4xs' },
  { date:'2026-03-12', start:'08:30', end:'21:00', org:'Capital Factory', name:'Capital Factory SXSW Events (Thu)', addr:'Capital Factory, 701 Brazos St, Austin TX', cost:'Free-$2500', tags:['Lounge','Networking','Tech'], url:'https://house.capitalfactory.com/agenda' },
  { date:'2026-03-12', start:'09:30', end:'20:00', org:'Food Tank', name:'7th Annual All Things Food Summit', addr:'Barr Mansion, 10463 Sprinkle Rd, Austin TX', cost:'Free w/ Badge', tags:['Session','Education','Culture'], url:'https://www.eventbrite.com/e/7th-annual-all-things-food-food-tank-summit-at-sxsw-2026-tickets-1978343041292' },
  { date:'2026-03-12', start:'11:00', end:'21:00', org:'Midwest House', name:'Midwest House Austin 2026 (Thu)', addr:'Texas Bankers Assoc, 203 W 10th St, Austin TX', cost:'Free', tags:['Showcase','Networking','Tech','Culture'], url:'https://luma.com/vght0n78' },
  { date:'2026-03-12', start:'11:00', end:'19:00', org:'Funded House', name:'Investor Lounge (Thu)', addr:'', cost:'Free', tags:['Lounge','Networking','Tech'], url:'https://luma.com/gqhs0akm' },
  { date:'2026-03-12', start:'12:00', end:'17:00', org:'ByxBreezy', name:'BYXCHELLA FEST', addr:'RichesArt Gallery, 2511 E 6th St, Austin TX', cost:'Free', tags:['Music','Art','Culture'], url:'https://www.eventbrite.com/e/byxchella-fest-tickets-1980727138190' },
  { date:'2026-03-12', start:'13:30', end:'21:00', org:'Texas Futures Coalition', name:'Texas Futures Summit', addr:'', cost:'Free', tags:['Session','Showcase','Networking','Tech'], url:'https://luma.com/eqdzabt0' },
  { date:'2026-03-12', start:'14:00', end:'18:30', org:'Physical AI Builders', name:'Physical AI Builders Showcase', addr:'', cost:'Free', tags:['Showcase','Session','AI','Tech'], url:'https://luma.com/vwllgca0' },
  { date:'2026-03-12', start:'14:00', end:'23:30', org:'AI Profit Machine', name:'AI Profit Machine House', addr:'Bungalow, 83 Rainey St, Austin TX', cost:'$0-319', tags:['AI','Networking','Party','Music'], url:'https://www.eventbrite.com/e/ai-profit-machine-house-sxsw-2026-tickets-1979631504119' },
  { date:'2026-03-12', start:'15:00', end:'23:00', org:'Soundcheck Live', name:'Made in Austin Official SXSW Showcase + Hackathon', addr:'Zilker Brewing, 1701 E 6th St, Austin TX', cost:'Free/Badge', tags:['Showcase','Music','AI','Tech'], url:'https://luma.com/mbbx3bai' },
  { date:'2026-03-12', start:'16:00', end:'19:00', org:'Cherub + Goodword', name:'Founder Heaven', addr:'Holiday, 5020 E 7th St, Austin TX', cost:'Free', tags:['Networking','Party','Tech'], url:'https://founderheaven.squarespace.com/' },
  { date:'2026-03-12', start:'17:00', end:'19:00', org:'Entre', name:'SXSW Founder/VC Kickoff Mixer', addr:'', cost:'Free', tags:['Networking','Party','Tech'], url:'https://luma.com/lx5itodv' },
  { date:'2026-03-12', start:'17:00', end:'18:30', org:'German Accelerator', name:'Future in Focus: Germany Top AI Startups', addr:'Speakeasy, 412 Congress Ave, Austin TX', cost:'Free', tags:['AI','Tech','Showcase','Networking'], url:'https://luma.com/x44yh804' },
  { date:'2026-03-12', start:'17:30', end:'22:00', org:'Startuplandia', name:'South by South Hold Em - Founder Investor Showdown', addr:'', cost:'$250+', tags:['Networking','Special Event','Tech'], url:'https://luma.com/mo8m8wd7' },
  { date:'2026-03-12', start:'18:00', end:'21:00', org:'dreambloc', name:'Build Together: Powered by Build in Tulsa', addr:'', cost:'Free', tags:['Networking','Culture','Tech'], url:'https://luma.com/pfvqe1aj' },
  { date:'2026-03-12', start:'18:00', end:'20:00', org:'Founders N Funders', name:'Founders N Funders: SXSW VC Reverse Pitch', addr:'', cost:'Free', tags:['Networking','Session','Tech'], url:'https://luma.com/fnfxsxsw0326' },
  { date:'2026-03-12', start:'18:30', end:'20:30', org:'Outlander VC', name:'Camp Outlander HardTech Meet Up', addr:'', cost:'Free', tags:['Networking','Party','Tech'], url:'https://luma.com/i9094b72' },
  { date:'2026-03-12', start:'19:00', end:'22:00', org:'Funded House', name:'Global Innovation Kickoff Party', addr:'', cost:'Free', tags:['Networking','Tech'], url:'https://luma.com/mgehpr84' },
  { date:'2026-03-12', start:'19:00', end:'01:00', org:'German Haus', name:'Startup Germany Night Party', addr:'Speakeasy, 412 Congress Ave, Austin TX', cost:'Free', tags:['Networking','Party','Tech'], url:'https://www.eventbrite.de/e/startup-germany-night-sxsw-2026-tickets-1982960538350' },

  // ── Fri Mar 13 (SXSW Day 2) ──
  { date:'2026-03-13', start:'08:00', end:'18:00', org:'PropTech Council', name:'PropTech House at SXSW', addr:'300 W MLK Jr Blvd, Austin TX', cost:'Free', tags:['Session','Showcase','Tech','Networking'], url:'https://luma.com/albuumsp' },
  { date:'2026-03-13', start:'09:00', end:'19:00', org:'Podcast Movement', name:'Podcast Movement at SXSW (Fri)', addr:'Skybox on 6th, 501 W 6th St, Austin TX', cost:'Free', tags:['Session','Networking','Culture'], url:'https://weekly.podcastmovement.com/p/why-we-re-bringing-podcast-movement-to-sxsw-and-making-it-free' },
  { date:'2026-03-13', start:'09:00', end:'12:00', org:'Pitch and Run ATX', name:'Annual SX Pitch and Run', addr:'Codependent Cocktails, 301 West Ave, Austin TX', cost:'Free', tags:['Networking','Tech','Special Event'], url:'https://luma.com/sxswpnr' },
  { date:'2026-03-13', start:'10:00', end:'16:00', org:'Openair Company', name:'TikTok House (Fri)', addr:'TikTok Austin, 300 Colorado St, Austin TX', cost:'Free', tags:['Networking','AI','Tech','Culture'], url:'https://www.eventbrite.com/e/tiktok-house-sxsw-austin-tickets-1982976751845' },
  { date:'2026-03-13', start:'10:00', end:'16:00', org:'Fast Company', name:'Fast Company Grill (Fri)', addr:'Cedar Door Patio, 201 Brazos St, Austin TX', cost:'Free', tags:['Activation','Networking','Tech'], url:'https://events.fastcompany.com/grill_2026/home' },
  { date:'2026-03-13', start:'10:00', end:'20:00', org:'Realtor.com', name:'PropTech Startup Showdown (Fri)', addr:'901 E 6th St, Austin TX', cost:'Free', tags:['Tech','Session','Networking'], url:'https://tech.realtor/nar-tech-innovation-at-sxsw/' },
  { date:'2026-03-13', start:'10:30', end:'23:00', org:'Inc.', name:'Inc. Founders House', addr:'Foxys Proper Pub, 201 Brazos St, Austin TX', cost:'Free', tags:['Lounge','Networking','Tech'], url:'https://events.inc.com/inc-founders-house-2026-austin/' },
  { date:'2026-03-13', start:'11:00', end:'12:00', org:'de:hub Initiative', name:'German Startup Showcase', addr:'Speakeasy, 412 Congress Ave, Austin TX', cost:'Free', tags:['Tech','Showcase','Session','Networking'], url:'https://www.eventbrite.de/e/german-startup-showcase-technology-for-a-better-life-health-empowerment-tickets-1982894021396' },
  { date:'2026-03-13', start:'11:00', end:'12:30', org:'Laurie Felker Jones', name:'Equitech Texas Welcome Breakfast', addr:'', cost:'Free', tags:['Networking','Tech','Culture'], url:'https://luma.com/peq53vu8' },
  { date:'2026-03-13', start:'11:00', end:'17:00', org:'AI Business Group', name:'Hail to the Innovators: U of Michigan at SXSW', addr:'716 Congress Ave, Austin TX', cost:'Free', tags:['Session','Showcase','Tech','Art'], url:'https://luma.com/asqx2mhv' },
  { date:'2026-03-13', start:'11:00', end:'23:00', org:'LAUNCH TENNESSEE', name:'Tennessee House at SXSW (Fri)', addr:'Electric Shuffle, 91 Red River St, Austin TX', cost:'Free', tags:['Tech','Activation','Culture'], url:'https://www.tn.house/' },
  { date:'2026-03-13', start:'12:00', end:'15:00', org:'LaFamilia', name:'Frontier House x LaFamilia VC Mixer', addr:'', cost:'Free', tags:['Networking','Party','Tech'], url:'https://luma.com/np5qzs55' },
  { date:'2026-03-13', start:'12:00', end:'23:59', org:'The Tech We Want', name:'The Light House 2026: Love is our LLM', addr:'The Belmont, 305 W 6th St, Austin TX', cost:'Free', tags:['Activation','Session','AI','Culture'], url:'https://www.eventbrite.com/e/the-light-house-2026-love-is-our-llm-tickets-1976791835594' },
  { date:'2026-03-13', start:'12:00', end:'16:00', org:'Austin Chronicle', name:'Hair of the Three Legged Dog Party', addr:'Hotel Vegas, 1502 E 6th St, Austin TX', cost:'Free', tags:['Music','Party','Culture'], url:'https://www.austinchronicle.com/day-party/' },
  { date:'2026-03-13', start:'14:00', end:'22:00', org:'Coca-Cola', name:'Sips & Sounds Music Festival (Fri)', addr:'Auditorium Shores, 800 W Riverside Dr, Austin TX', cost:'$65-125+', tags:['Music','Showcase','Special Event'], url:'https://www.sipssoundsfest.com/' },
  { date:'2026-03-13', start:'16:30', end:'22:30', org:'Nucleate', name:'Nucleate Texas House @ SXSW', addr:'', cost:'Free', tags:['Networking','Party','Music','Tech'], url:'https://luma.com/nucleate-sxsw-2026' },
  { date:'2026-03-13', start:'17:30', end:'19:00', org:'Liberty Ventures', name:'Liberty Ventures Reception', addr:'', cost:'Free', tags:['Networking','Session','Tech'], url:'https://luma.com/wfmm3v5y' },
  { date:'2026-03-13', start:'18:00', end:'20:30', org:'Pitch Roast Live', name:'Pitch Roast Live SXSW', addr:'Pershing Hall, 2415C E 5th St, Austin TX', cost:'Free', tags:['Comedy','Showcase','Networking','Tech'], url:'https://luma.com/pitchroastsxsw' },
  { date:'2026-03-13', start:'21:00', end:'01:00', org:'Olesia Yuvko', name:'Brave1 Invest Demo Day Austin', addr:'', cost:'Free', tags:['Session','Showcase','Tech','Networking'], url:'https://luma.com/uvei2k2q' },

  // ── Sat Mar 14 (SXSW Day 3) ──
  { date:'2026-03-14', start:'07:00', end:'15:30', org:'The Female Quotient', name:'FQ Lounge at SXSW (Sat)', addr:'Waller Creek Boathouse, 74 Trinity St, Austin TX', cost:'Free', tags:['Lounge','Networking','Culture','Tech'], url:'https://events.thefemalequotient.com/sxsw26/invite' },
  { date:'2026-03-14', start:'08:00', end:'10:30', org:'Elle Beecher', name:'The Board Walks Austin', addr:'Bennu Coffee, 515 S Congress Ave, Austin TX', cost:'Free', tags:['Networking','Culture'], url:'https://www.theboardwalks.com/' },
  { date:'2026-03-14', start:'09:00', end:'17:00', org:'Vi Ma', name:'RedThreadX House at The LINE (Sat)', addr:'The LINE Austin, 111 E Cesar Chavez St, Austin TX', cost:'Free', tags:['Session','Screening','Networking','Tech'], url:'https://luma.com/u4q9akh7' },
  { date:'2026-03-14', start:'10:00', end:'16:00', org:'Openair Company', name:'TikTok House (Sat)', addr:'TikTok Austin, 300 Colorado St, Austin TX', cost:'Free', tags:['Networking','AI','Tech','Culture'], url:'https://www.eventbrite.com/e/tiktok-house-sxsw-austin-tickets-1982976751845' },
  { date:'2026-03-14', start:'10:00', end:'17:00', org:'SHE Media', name:'SHE Media Co Lab (Sat)', addr:'612 W 4th St, Austin TX', cost:'Free', tags:['Session','Education','Culture'], url:'https://shemedia.swoogo.com/smcolab26/begin' },
  { date:'2026-03-14', start:'10:00', end:'19:00', org:'Fast Company', name:'Fast Company Grill (Sat)', addr:'Cedar Door Patio, 201 Brazos St, Austin TX', cost:'Free', tags:['Activation','Networking','Tech'], url:'https://events.fastcompany.com/grill_2026/home' },
  { date:'2026-03-14', start:'10:00', end:'22:00', org:'Juice Consulting', name:'Space House @ SXSW 2026', addr:'201 E 5th St, Austin TX', cost:'Free', tags:['Activation','Tech','Education'], url:'https://www.eventbrite.com/e/space-house-sxsw-2026-tickets-1983032882734' },
  { date:'2026-03-14', start:'11:00', end:'13:00', org:'Microsoft for Startups', name:'Founders & Funders Breakfast by Microsoft + LinkedIn', addr:'', cost:'Free', tags:['Networking','Tech'], url:'https://luma.com/qt1zbrf8' },
  { date:'2026-03-14', start:'11:00', end:'16:30', org:'Axios', name:'Axios House', addr:'Inn Cahoots, 1221 E 6th St, Austin TX', cost:'Free', tags:['Session','Tech','Film/TV','Culture'], url:'https://axioshouseatsxsw-interest.splashthat.com/' },
  { date:'2026-03-14', start:'11:00', end:'17:00', org:'Kamp', name:'Founder Fest Austin - SXSW Edition', addr:'Cabana Club, 5012 E 7th St, Austin TX', cost:'Free-$630', tags:['Session','Party','Networking','Tech'], url:'https://luma.com/founder-fest' },
  { date:'2026-03-14', start:'12:00', end:'17:00', org:'Realtor.com', name:'PropTech Startup Showdown (Sat)', addr:'901 E 6th St, Austin TX', cost:'Free', tags:['Tech','Session','Networking'], url:'https://tech.realtor/nar-tech-innovation-at-sxsw/' },
  { date:'2026-03-14', start:'12:00', end:'19:30', org:'Monica Talan', name:'Capital for the Culture Innovation Hub', addr:'The Cathedral, 2403 E 16th St, Austin TX', cost:'Free', tags:['Session','Showcase','Culture','Networking'], url:'https://luma.com/kwesfcnr' },
  { date:'2026-03-14', start:'12:00', end:'20:00', org:'Slovak PRO', name:'Going BIG in Texas - Slovak House', addr:'Q-Branch, 200 E 6th St, Austin TX', cost:'Free', tags:['Session','Showcase','Networking','Music'], url:'https://luma.com/SlovakHouse' },
  { date:'2026-03-14', start:'13:00', end:'16:00', org:'Outlander VC', name:'Camp Outlander X SXSW BBQ', addr:'', cost:'Free', tags:['Party','Networking','Tech'], url:'https://luma.com/5yo4wovy' },
  { date:'2026-03-14', start:'13:00', end:'16:00', org:'REGEN HOUSE', name:'The Future of Protein Forum', addr:'', cost:'Free', tags:['Session','Education','Tech'], url:'https://luma.com/meat-institute-sxsw-2026' },
  { date:'2026-03-14', start:'15:00', end:'21:00', org:'Creative House', name:'DreamFest at SXSW', addr:'Factory on 5th, 3409 E 5th St, Austin TX', cost:'$0-25', tags:['Music','Showcase','Culture'], url:'https://www.eventbrite.com/e/dreamfest-at-sxsw-tickets-1980317124829' },
  { date:'2026-03-14', start:'17:00', end:'19:00', org:'Amplify Philly', name:'Pennsylvania Alumni Happy Hour', addr:'Half Step, 75 Rainey St, Austin TX', cost:'Free', tags:['Networking','Party','Culture'], url:'https://luma.com/8ftimrc7' },
  { date:'2026-03-14', start:'17:30', end:'20:00', org:'RockWater', name:'Creator Exec Event by RockWater', addr:'The Eleanor, 307 W 5th St, Austin TX', cost:'$20-50', tags:['Networking','Party','Tech'], url:'https://luma.com/pf4dxzg8' },

  // ── Sun Mar 15 (SXSW Day 4) ──
  { date:'2026-03-15', start:'07:00', end:'15:00', org:'The Female Quotient', name:'FQ Lounge at SXSW (Sun)', addr:'Waller Creek Boathouse, 74 Trinity St, Austin TX', cost:'Free', tags:['Lounge','Networking','Culture','Tech'], url:'https://events.thefemalequotient.com/sxsw26/invite' },
  { date:'2026-03-15', start:'09:00', end:'17:00', org:'Vi Ma', name:'RedThreadX House at The LINE (Sun)', addr:'The LINE Austin, 111 E Cesar Chavez St, Austin TX', cost:'Free', tags:['Session','Screening','Networking','Tech'], url:'https://luma.com/u4q9akh7' },
  { date:'2026-03-15', start:'10:00', end:'17:00', org:'SHE Media', name:'SHE Media Co Lab (Sun)', addr:'612 W 4th St, Austin TX', cost:'Free', tags:['Session','Education','Culture'], url:'https://shemedia.swoogo.com/smcolab26/begin' },
  { date:'2026-03-15', start:'10:00', end:'19:00', org:'Fast Company', name:'Fast Company Grill (Sun)', addr:'Cedar Door Patio, 201 Brazos St, Austin TX', cost:'Free', tags:['Activation','Networking','Tech'], url:'https://events.fastcompany.com/grill_2026/home' },
  { date:'2026-03-15', start:'13:00', end:'19:00', org:'Paseo/LV Collective', name:'Design House', addr:'80 Rainey St, Austin TX', cost:'Free', tags:['Session','Networking','Party','Art'], url:'https://www.designhouseatx.com/' },
  { date:'2026-03-15', start:'16:00', end:'17:30', org:'Jane Nadaraja', name:'Superhuman Hang @ SXSW', addr:'Antones Nightclub, 305 E 5th St, Austin TX', cost:'Free', tags:['Networking','Party','Tech'], url:'https://luma.com/2e1g9wr9' },
  { date:'2026-03-15', start:'16:00', end:'19:00', org:'James Jackson Leach', name:'Drinks on James (SXSW)', addr:'Mort Subite, 308 Congress Ave, Austin TX', cost:'Free', tags:['Networking','AI','Tech'], url:'https://luma.com/ksngov2z' },
  { date:'2026-03-15', start:'16:00', end:'18:30', org:'HubSpot for Startups', name:'From Raise to Reality: Series A Founders', addr:'Soho House Austin, 1011 S Congress Ave, Austin TX', cost:'Free', tags:['Session','Networking','Tech'], url:'https://luma.com/glbmqm6u' },
  { date:'2026-03-15', start:'16:00', end:'19:00', org:'Haly Berni', name:'London Calling: Pioneering Ideas Meet Business', addr:'Hanghart, 208 W 4th St, Austin TX', cost:'Free', tags:['Networking','Session','Tech'], url:'https://luma.com/rd044u94' },
  { date:'2026-03-15', start:'17:00', end:'20:00', org:'NachoNacho', name:'NachoTuesday: SaaS & AI Founder + Investor Happy Hour', addr:'', cost:'Free', tags:['Networking','AI','Tech'], url:'https://luma.com/wddaow8l' },
  { date:'2026-03-15', start:'18:00', end:'21:00', org:'Unicorner', name:'Emerging Managers + Founding GPs Omakase', addr:'', cost:'Free', tags:['Special Event','Networking','Tech'], url:'https://luma.com/njj07v0h' },
  { date:'2026-03-15', start:'19:00', end:'23:00', org:'Brett Perlmutter', name:'Tech Carnival', addr:'', cost:'Free', tags:['Showcase','Networking','Tech','Culture'], url:'https://luma.com/ohk51ec9' },

  // ── Mon Mar 16 (SXSW Day 5) ──
  { date:'2026-03-16', start:'08:30', end:'23:00', org:'Non-Obvious Company', name:'The Non Obvious Clubhouse Party', addr:'Near ACC, 500 E 4th St, Austin TX', cost:'Free', tags:['Party','Networking','Culture'], url:'https://www.eventbrite.com/e/the-non-obvious-clubhouse-party-sxsw-2026-tickets-1761827586739' },
  { date:'2026-03-16', start:'09:00', end:'12:30', org:'DWT Events', name:'Founded in Texas For Women Founders', addr:'Brown Advisory, 200 W 6th St, Austin TX', cost:'Free', tags:['Networking','Tech','Education'], url:'https://dwtevents.com/foundedintexas/' },
  { date:'2026-03-16', start:'09:00', end:'17:00', org:'Vi Ma', name:'RedThreadX House at The LINE (Mon)', addr:'The LINE Austin, 111 E Cesar Chavez St, Austin TX', cost:'Free', tags:['Session','Screening','Networking','Tech'], url:'https://luma.com/u4q9akh7' },
  { date:'2026-03-16', start:'09:00', end:'19:30', org:'New Mexico House', name:'The Land of Enchantment', addr:'The Courtyard ATX, 208 W 4th St, Austin TX', cost:'Free', tags:['Activation','Culture','Tech'], url:'https://newmexicohouse.org/' },
  { date:'2026-03-16', start:'09:30', end:'18:00', org:'Hacks/Hackers', name:'AI x Journalism Day 2026', addr:'', cost:'Free', tags:['Session','AI','Education','Networking'], url:'https://luma.com/hh-ai-journalism-day-2026-austin' },
  { date:'2026-03-16', start:'11:00', end:'21:00', org:'Humble Ventures', name:'The Future of Health', addr:'', cost:'$20', tags:['Session','Tech','Education','Networking'], url:'https://luma.com/79uagf6k' },
  { date:'2026-03-16', start:'12:00', end:'16:00', org:'Ritual House', name:'Common Ground', addr:'2055 S Lamar Blvd, Austin TX', cost:'Free', tags:['Lounge','Culture','Networking'], url:'https://luma.com/4smqergu' },
  { date:'2026-03-16', start:'13:00', end:'15:00', org:'VCA', name:'VC Arena: SXSW', addr:'W Austin, 200 Lavaca St, Austin TX', cost:'Free', tags:['Session','Networking','Tech'], url:'https://luma.com/hbu8k62y' },
  { date:'2026-03-16', start:'13:00', end:'17:00', org:'ASK WOLF', name:'A Day of Culture, Connection & Growth', addr:'Umlauf Sculpture Garden, 605 Azie Morton Rd, Austin TX', cost:'Free-$100+', tags:['Session','Art','Music','Networking'], url:'https://luma.com/wolf-connect-sxsw-2026' },
  { date:'2026-03-16', start:'14:30', end:'17:00', org:'Ron Brown Venture Lab', name:'Our Path Forward: Austin Tech Leaders', addr:'Oracle, 2300 Oracle Wy, Austin TX', cost:'Free', tags:['Session','Tech','Education','Networking'], url:'https://luma.com/f3ch1cru' },
  { date:'2026-03-16', start:'14:30', end:'18:00', org:'Long 100', name:'Real Estate Forum: AI, PropTech, Construction', addr:'UT Austin, Austin TX', cost:'Free', tags:['Showcase','Session','Networking','Tech'], url:'https://luma.com/t8x0dcsq' },
  { date:'2026-03-16', start:'15:00', end:'18:00', org:'Orrick', name:'The LegalTech AI Boom', addr:'Indeed Tower, 200 W 6th St, Austin TX', cost:'Free', tags:['Session','Tech','Education','Networking'], url:'https://luma.com/kmtg9hwd' },
  { date:'2026-03-16', start:'17:00', end:'19:30', org:'Microsoft for Startups', name:'Microsoft Founder x Funder Dinner', addr:'', cost:'Free', tags:['Special Event','Networking','Tech'], url:'https://luma.com/ig3nyeww' },
];

async function run() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Update core SXSW event
  await c.query(`
    UPDATE events SET
      description = 'SXSW celebrates the convergence of tech, film, music, education, and culture. For its 40th year, SXSW decentralizes into downtown Austin clubhouses across Innovation (Brazos Hall), Film & TV (800 Congress), and Music (The Downright). 850+ sessions, 600+ networking events, 4400+ musicians.',
      event_date = '2026-03-12',
      start_at = '2026-03-12 09:00:00',
      end_at = '2026-03-18 23:00:00',
      timezone = 'America/Chicago',
      themes = '["AI", "Enterprise SaaS", "FinTech", "HealthTech", "EdTech", "Gaming", "Climate Tech"]',
      source_url = 'https://sxsw.com',
      expected_attendees = '75000',
      updated_at = NOW()
    WHERE id = $1
  `, [PARENT_ID]);
  console.error('Updated SXSW core event');

  let inserted = 0;
  let skipped = 0;

  for (const s of sidecars) {
    try {
      await c.query(`
        INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_address, cost, tags, themes, source_url, invite_only)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (parent_event_id, name, event_date) DO NOTHING
      `, [
        PARENT_ID,
        s.name,
        s.org,
        s.date,
        s.start,
        s.end,
        s.addr || null,
        s.cost,
        JSON.stringify(s.tags),
        JSON.stringify(s.tags.filter(t => ['AI','Tech','Culture','Education'].includes(t)).map(t => t === 'Tech' ? 'Enterprise SaaS' : t)),
        s.url,
        s.invite || false
      ]);
      inserted++;
    } catch(e) {
      console.error('Skip:', s.name, e.message);
      skipped++;
    }
  }

  const count = await c.query('SELECT COUNT(*) as n FROM sidecar_events WHERE parent_event_id = $1', [PARENT_ID]);
  console.error('Inserted:', inserted, '| Skipped:', skipped, '| Total SXSW sidecars:', count.rows[0].n);
  await c.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });